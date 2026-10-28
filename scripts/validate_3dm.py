#!/usr/bin/env python3
"""
Independent validation of an OM Studio .3dm export.

Reads the file with McNeel's *Python* rhino3dm (a separate openNURBS binding from the JS one that
wrote it) and checks it against the manifest and configuration embedded in the file itself.

    python3 -m venv .venv-validate && .venv-validate/bin/pip install rhino3dm
    .venv-validate/bin/python scripts/validate_3dm.py exports/om-300-flagship_round01.3dm

Exit code 0 = all checks passed.
"""
import json
import math
import sys
from collections import Counter

import rhino3dm as r

TOL = 1e-6


class Report:
    def __init__(self):
        self.failures = 0

    def check(self, ok, label, detail=""):
        mark = "PASS" if ok else "FAIL"
        if not ok:
            self.failures += 1
        print(f"  [{mark}] {label}" + (f" — {detail}" if detail else ""))
        return ok


def strings(model):
    return {model.Strings[i][0]: model.Strings[i][1] for i in range(len(model.Strings))}


def bbox(geom):
    b = geom.GetBoundingBox()
    return (b.Min.X, b.Min.Y, b.Min.Z), (b.Max.X, b.Max.Y, b.Max.Z)


def exact_points(g):
    """Points known exactly on the object (openNURBS bounding boxes of curved objects use the
    control hull, which overshoots, so they cannot be used for containment checks)."""
    if isinstance(g, r.Point):
        return [(g.Location.X, g.Location.Y, g.Location.Z)]
    if isinstance(g, r.InstanceReference):
        return [(g.Xform.M03, g.Xform.M13, g.Xform.M23)]
    if isinstance(g, r.Extrusion):
        g = g.ToBrep(False)
    if isinstance(g, r.Brep):
        return [(v.Location.X, v.Location.Y, v.Location.Z) for v in g.Vertices]
    if isinstance(g, r.Curve):
        return [(p.X, p.Y, p.Z) for p in (g.PointAtStart, g.PointAtEnd)]
    return []


def main(path):
    rep = Report()
    print(f"OM Studio export validation: {path}")
    model = r.File3dm.Read(path)
    if model is None:
        print("  [FAIL] file could not be read")
        return 1

    s = strings(model)
    manifest = json.loads(s["om.manifest"])
    config = json.loads(s["om.configuration"])
    R = config["sphere"]["radius"]

    print("\nFile")
    rep.check(model.Settings.ModelUnitSystem == r.UnitSystem.Meters, "units are metres", str(model.Settings.ModelUnitSystem))
    rep.check(s.get("om.schema") == manifest["schema"], "schema tag", s.get("om.schema", ""))
    rep.check(manifest["configurationId"] == config["id"], "manifest matches embedded configuration", config["id"])

    print("\nLayers")
    paths = [l.FullPath for l in model.Layers]
    missing = [p for p in manifest["layers"] if p not in paths]
    rep.check(not missing, f"all {len(manifest['layers'])} layers present", ", ".join(missing[:5]))
    rep.check(all(p.startswith("OM_STUDIO") for p in paths), "every layer sits under OM_STUDIO")

    print("\nObjects")
    top = [o for o in model.Objects if not o.Attributes.IsInstanceDefinitionObject]
    rep.check(len(top) == manifest["objectCount"], "object count", f"{len(top)} in file vs {manifest['objectCount']} in manifest")
    by_layer = Counter(paths[o.Attributes.LayerIndex] for o in top)
    diffs = {k: (by_layer.get(k, 0), v) for k, v in manifest["countsByLayer"].items() if by_layer.get(k, 0) != v}
    rep.check(not diffs, "objects per layer match manifest", str(diffs) if diffs else ", ".join(f"{k.split('::')[-1]}={v}" for k, v in sorted(by_layer.items())))
    ids = [o.Attributes.GetUserString("om.object_id") for o in top]
    rep.check(all(ids) and len(set(ids)) == len(ids), "every object has a unique om.object_id")
    kinds = Counter(type(o.Geometry).__name__ for o in top)
    print("     geometry types:", dict(kinds))
    by_id = {o.Attributes.GetUserString("om.object_id"): o for o in top}

    print("\nBlocks")
    idefs = {d.Name: d for d in model.InstanceDefinitions}
    for b in manifest["blocks"]:
        d = idefs.get(b["name"])
        if not rep.check(d is not None, f"block definition {b['name']}"):
            continue
        refs = [o for o in top if isinstance(o.Geometry, r.InstanceReference) and str(o.Geometry.ParentIdefId) == str(d.Id)]
        rep.check(len(refs) == b["instances"], f"  {b['instances']} instances reference it", f"found {len(refs)}")
    seats = [o for o in top if o.Attributes.GetUserString("om.category") == "Seat"]
    rep.check(len(seats) == manifest["seatCount"], "seat count", f"{len(seats)}")
    rep.check(all(isinstance(o.Geometry, r.InstanceReference) for o in seats), "seats are block instances")
    rep.check(all(o.Attributes.GetUserString("om.row") and o.Attributes.GetUserString("om.manufacturer") for o in seats), "seats carry row / manufacturer metadata")

    print("\nReference geometry")
    origin = by_id["ref.origin"].Geometry.Location
    rep.check(abs(origin.X) + abs(origin.Y) + abs(origin.Z) < TOL, "World_Origin at (0, 0, 0)")
    lo, hi = bbox(by_id["ref.sphere"].Geometry)
    rep.check(all(abs(v + R) < 1e-6 for v in lo) and all(abs(v - R) < 1e-6 for v in hi), f"reference sphere bbox = ±{R} m (centred on origin)")

    print("\nMedia surface (exact sphere check)")
    media = by_id["media.ideal"].Geometry
    rep.check(isinstance(media, r.Brep) and len(media.Faces) == 1, "media surface is a single-face Brep")
    srf = media.Faces[0].UnderlyingSurface()
    nurbs = srf.ToNurbsSurface()
    rep.check(nurbs.IsRational and nurbs.Degree(0) == 2 and nurbs.Degree(1) == 2, "rational degree-2 NURBS (exact, not a mesh)")
    du, dv = srf.Domain(0), srf.Domain(1)
    m = manifest["media"]
    rep.check(abs(du.T0 - m["azimuth0"]) < TOL and abs(du.T1 - m["azimuth1"]) < TOL, "u-domain equals azimuth limits (rad)", f"{du.T0:.5f}..{du.T1:.5f}")
    rep.check(abs(dv.T0 - m["elevation0"]) < TOL and abs(dv.T1 - m["elevation1"]) < TOL, "v-domain equals elevation limits (rad)", f"{dv.T0:.5f}..{dv.T1:.5f}")
    worst = 0.0
    n = 40
    for i in range(n + 1):
        for j in range(n + 1):
            p = srf.PointAt(du.T0 + (du.T1 - du.T0) * i / n, dv.T0 + (dv.T1 - dv.T0) * j / n)
            worst = max(worst, abs(math.sqrt(p.X ** 2 + p.Y ** 2 + p.Z ** 2) - R))
    rep.check(worst < 1e-9 * R, f"{(n + 1) ** 2} sampled points lie on the sphere", f"max |r - R| = {worst:.2e} m")
    corner = srf.PointAt(du.T0, dv.T0)
    exp = (R * math.cos(m["elevation0"]) * math.sin(m["azimuth0"]), R * math.cos(m["elevation0"]) * math.cos(m["azimuth0"]), R * math.sin(m["elevation0"]))
    rep.check(math.dist((corner.X, corner.Y, corner.Z), exp) < 1e-9, "lower-left corner at P(θ0, φ0)")

    print("\nCoordinates and dimensions")
    for cp in manifest["checkpoints"]:
        o = by_id.get(cp["id"])
        if o is None:
            continue
        g = o.Geometry
        if isinstance(g, r.InstanceReference):
            got = (g.Xform.M03, g.Xform.M13, g.Xform.M23)
        elif isinstance(g, r.Point):
            got = (g.Location.X, g.Location.Y, g.Location.Z)
        else:
            got = bbox(g)[0]
        rep.check(math.dist(got, cp["point"]) < 1e-6, f"{cp['id']} at {tuple(round(v, 4) for v in cp['point'])}")
    def pose_dz(o):
        v = o.Attributes.GetUserString("om.pose_offset")
        return float(v.split(",")[2]) if v else 0.0
    st = config["stage"]
    lo, hi = bbox(by_id["stage.main"].Geometry)
    stage_dz = pose_dz(by_id["stage.main"])
    stage_top = hi[2]
    rep.check(abs((hi[0] - lo[0]) - st["width"]) < TOL and abs((hi[1] - lo[1]) - st["depth"]) < TOL and abs((hi[2] - lo[2]) - st["height"]) < TOL,
              "stage dimensions match configuration", f"{hi[0]-lo[0]:.3f} × {hi[1]-lo[1]:.3f} × {hi[2]-lo[2]:.3f} m")
    floor = config["floor"]["mainFloorElevation"]
    rep.check(abs(lo[2] - stage_dz - floor) < TOL, "stage sits on the main floor" + (" (before lowering)" if stage_dz else ""), f"z = {lo[2] - stage_dz:.4f}")
    tiers = [o for o in top if o.Attributes.GetUserString("om.category") == "SeatingTier"]
    def tier_bottom(o):
        v = o.Attributes.GetUserString("om.tier_bottom_z")
        return float(v) if v else floor
    bad = [o.Attributes.Name for o in tiers if abs(bbox(o.Geometry)[1][2] - pose_dz(o) - float(o.Attributes.GetUserString("om.tier_top_z"))) > 1e-4 or abs(bbox(o.Geometry)[0][2] - pose_dz(o) - tier_bottom(o)) > 1e-4]
    rep.check(tiers and not bad, f"{len(tiers)} tier platforms/decks span their stated bottom → tier top", ", ".join(bad))
    half = R + config["envelope"]["serviceZone"]
    outside = [o.Attributes.Name for o in top if any(abs(x) > half + 1e-6 or abs(y) > half + 1e-6 for x, y, _ in exact_points(o.Geometry))]
    rep.check(not outside, f"all objects inside the {2*half:.1f} m design envelope (plan, exact vertices)", ", ".join(outside[:5]))

    led = manifest.get("led")
    if led:
        print("\nLED system")
        units = [o for o in top if (o.Attributes.GetUserString("om.category") or "").startswith("LED")]
        rep.check(len(units) == led["count"], f"{led['count']} LED units", f"found {len(units)}")
        rep.check(all(o.Attributes.GetUserString("om.deviation_mm") is not None and o.Attributes.GetUserString("om.curvature_ok") for o in units), "every unit carries deviation, joint and curvature metadata")
        if led["strategy"] == "rings":
            refs = [o.Geometry for o in units if isinstance(o.Geometry, r.InstanceReference)]
            rep.check(len(refs) == len(units), "units are block instances")
            def rigid(x):
                cols = [(x.M00, x.M10, x.M20), (x.M01, x.M11, x.M21), (x.M02, x.M12, x.M22)]
                ortho = all(abs(sum(a * b for a, b in zip(cols[i], cols[j])) - (1 if i == j else 0)) < 1e-9 for i in range(3) for j in range(3))
                det = (cols[0][0] * (cols[1][1] * cols[2][2] - cols[1][2] * cols[2][1]) - cols[1][0] * (cols[0][1] * cols[2][2] - cols[0][2] * cols[2][1]) + cols[2][0] * (cols[0][1] * cols[1][2] - cols[0][2] * cols[1][1]))
                return ortho and abs(det - 1) < 1e-9
            rep.check(all(rigid(g.Xform) for g in refs), "no unit is scaled or skewed (rigid transforms, true size)")
            d = model.InstanceDefinitions.FindId(refs[0].ParentIdefId) if refs else None
            if d is not None:
                parts = [model.Objects.FindId(i).Geometry for i in d.GetObjectIds()]
                lo = [min(bbox(g)[0][k] for g in parts) for k in range(3)]
                hi = [max(bbox(g)[1][k] for g in parts) for k in range(3)]
                u = led["unit"]
                rep.check(abs(hi[0] - lo[0] - u["w"]) < 1e-9 and abs(hi[1] - lo[1] - u["h"]) < 1e-9 and abs(hi[2] - lo[2] - u["d"]) < 1e-9,
                          "unit block matches the product's true size", f"{(hi[0]-lo[0])*1000:.1f} × {(hi[1]-lo[1])*1000:.1f} × {(hi[2]-lo[2])*1000:.1f} mm")
            # Every front-face corner within the reported deviation of the sphere.
            worst = 0.0
            for g in refs:
                x = g.Xform
                for sx in (-1, 1):
                    for sy in (-1, 1):
                        lx, ly = sx * led["unit"]["w"] / 2, sy * led["unit"]["h"] / 2
                        p = (x.M00 * lx + x.M01 * ly + x.M03, x.M10 * lx + x.M11 * ly + x.M13, x.M20 * lx + x.M21 * ly + x.M23)
                        worst = max(worst, abs(math.dist(p, (0, 0, 0)) - R))
            rep.check(abs(worst - led["maxDeviation"]) < 1e-6, "face corners deviate from the sphere by the reported maximum", f"{worst*1000:.2f} mm")
        else:
            worst = 0.0
            for o in units:
                srf = o.Geometry.Faces[0].UnderlyingSurface() if isinstance(o.Geometry, r.Brep) else None
                if srf is None:
                    worst = float("inf")
                    break
                du, dv = srf.Domain(0), srf.Domain(1)
                for i in range(3):
                    for j in range(3):
                        p = srf.PointAt(du.T0 + (du.T1 - du.T0) * i / 2, dv.T0 + (dv.T1 - dv.T0) * j / 2)
                        worst = max(worst, abs(math.dist((p.X, p.Y, p.Z), (0, 0, 0)) - R))
            rep.check(worst < 1e-9 * R, "every tile is an exact sphere patch", f"max |r - R| = {worst:.2e} m")
            types = {o.Attributes.GetUserString("om.tile_type") for o in units}
            rep.check(len(types) == led["unitTypes"], f"{led['unitTypes']} tile types", f"found {len(types)}")

    imm = manifest.get("immersion")
    if imm:
        print("\nImmersion analysis")
        rays = [o for o in top if o.Attributes.GetUserString("om.category") == "Sightline"]
        targets = [o for o in top if o.Attributes.GetUserString("om.category") == "ViewingTarget"]
        rep.check(len(rays) == len(seats), "one sightline ray per seat", f"{len(rays)} rays")
        rep.check(len(targets) == 1 and isinstance(targets[0].Geometry, r.Point), "one viewing target point")
        if targets:
            t = targets[0].Geometry.Location
            ends = [o.Geometry.PointAtEnd for o in rays]
            rep.check(all(math.dist((e.X, e.Y, e.Z), (t.X, t.Y, t.Z)) < 1e-9 for e in ends), "every ray ends on the viewing target")
        seat_xy = {o.Attributes.GetUserString("om.object_id"): (o.Geometry.Xform.M03, o.Geometry.Xform.M13, o.Geometry.Xform.M23) for o in seats}
        off = [o.Attributes.Name for o in rays
               if (lambda st, p: math.hypot(st.X - p[0], st.Y - p[1]) > 1.0 or not (0.5 < st.Z - p[2] < 1.6))(o.Geometry.PointAtStart, seat_xy[o.Attributes.GetUserString("om.seat_id")])]
        rep.check(not off, "every ray starts at a seated eye height above its seat", ", ".join(off[:5]))
        grades = [(0.8, "excellent"), (0.65, "good"), (0.5, "acceptable"), (0.35, "compromised"), (-1e9, "unacceptable")]
        scores = []
        wrong = []
        for o in seats:
            sc = float(o.Attributes.GetUserString("om.immersion_score"))
            scores.append(sc)
            if o.Attributes.GetUserString("om.immersion_grade") != next(g for lim, g in grades if sc >= lim):
                wrong.append(o.Attributes.Name)
        rep.check(not wrong, "seat grades follow the published thresholds", ", ".join(wrong[:5]))
        avg = sum(scores) / len(scores) if scores else 0
        rep.check(abs(avg - imm["average"]) < 1e-3, "seat scores average to the manifest figure", f"{avg:.4f} vs {imm['average']}")

    kin = manifest.get("transformation")
    if kin:
        print(f"\nTransformation ({manifest['state']} state)")
        paths = {o.Attributes.GetUserString("om.assembly"): o for o in top if o.Attributes.GetUserString("om.category") == "MotionPath"}
        moving = [a for a in kin["assemblies"] if any(a["travel"])]
        rep.check(len(paths) == len(moving) and all(a["id"] in paths for a in moving), f"one explicit motion path per moving assembly ({len(moving)} of {len(kin['assemblies'])})", f"found {len(paths)}")
        wrong = []
        for a in moving:
            g = paths.get(a["id"])
            if g is None or not isinstance(g.Geometry, r.LineCurve):
                wrong.append(a["id"])
                continue
            p0, p1 = g.Geometry.PointAtStart, g.Geometry.PointAtEnd
            if math.dist((p1.X - p0.X, p1.Y - p0.Y, p1.Z - p0.Z), a["travel"]) > 1e-6:
                wrong.append(a["id"])
        rep.check(not wrong, "every path is a straight line equal to its assembly's travel", ", ".join(wrong[:5]))
        rep.check(all("conceptual" in (o.Attributes.GetUserString("om.status") or "") for o in paths.values()), "every path is marked conceptual")
        hold = min((a["start"] for a in moving), default=0)
        rep.check(hold >= config["transformation"]["clearanceHoldS"] - 1e-6, f"nothing moves before the {config['transformation']['clearanceHoldS']} s audience clearance", f"first motion at {hold} s")
        moved = [o for o in top if o.Attributes.GetUserString("om.pose_offset")]
        expected = sum(a["members"] for a in kin["assemblies"] if any(a["travel"])) if manifest["state"] == "standing" else 0
        rep.check(len(moved) == expected, f"{expected} objects moved to the {manifest['state']} pose", f"found {len(moved)}")
        if manifest["state"] == "standing":
            travel = {a["id"]: a["travel"] for a in kin["assemblies"]}
            off = [o.Attributes.Name for o in moved if o.Attributes.GetUserString("om.parent_assembly") in travel
                   and math.dist([float(v) for v in o.Attributes.GetUserString("om.pose_offset").split(",")], travel[o.Attributes.GetUserString("om.parent_assembly")]) > 1e-6]
            rep.check(not off, "moved seating sits exactly one path length from its seated position", ", ".join(off[:5]))
            rep.check(all(o.Attributes.GetUserString("om.folded") == "yes" for o in seats if o.Attributes.GetUserString("om.pose_offset")), "moved seats are marked folded")
            if config["transformation"]["stage"] == "lift":
                rep.check(abs(stage_top - floor) < TOL, "lowered stage is flush with the floor", f"top z = {stage_top:.4f}")
            rep.check(not [o for o in top if (o.Attributes.GetUserString("om.layer") or "").startswith("07_ANALYSIS/Sightline")], "no seated sightlines in the standing state")

    print()
    if rep.failures:
        print(f"{rep.failures} check(s) FAILED")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
