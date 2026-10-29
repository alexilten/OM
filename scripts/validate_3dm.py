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
    # Torus form: ring radius of the tube centre circle (0 = sphere). Distances to the screen are taken
    # from that circle; inside the ring opening only the height counts.
    ring = manifest.get("ringRadius", 0) or 0

    def tube(x, y, z):
        return math.hypot(max(math.hypot(x, y) - ring, 0.0), z)

    def pose(o):
        """Offset of a moved object in the standing state (0, 0, 0 when it has not moved)."""
        v = o.Attributes.GetUserString("om.pose_offset") or o.Attributes.GetUserString("om.carriage_offset_m")
        return tuple(float(x) for x in v.split(",")) if v else (0.0, 0.0, 0.0)

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
    ext = (ring + R, ring + R, R)
    rep.check(all(abs(v + e) < 1e-6 for v, e in zip(lo, ext)) and all(abs(v - e) < 1e-6 for v, e in zip(hi, ext)),
              f"reference {'torus' if ring else 'sphere'} bbox = ±{ring + R} × ±{R} m (centred on origin)" if ring else f"reference sphere bbox = ±{R} m (centred on origin)")

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
            worst = max(worst, abs(tube(p.X, p.Y, p.Z) - R))
    rep.check(worst < 1e-9 * R, f"{(n + 1) ** 2} sampled points lie on the {'torus' if ring else 'sphere'}", f"max |r - R| = {worst:.2e} m")
    corner = srf.PointAt(du.T0, dv.T0)
    rho0 = ring + R * math.cos(m["elevation0"])
    exp = (rho0 * math.sin(m["azimuth0"]), rho0 * math.cos(m["azimuth0"]), R * math.sin(m["elevation0"]))
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
    stage_obj = by_id["stage.main"]
    joined = stage_obj.Attributes.GetUserString("om.joined_to_screen") == "yes"
    if not joined:
        rep.check(abs((hi[0] - lo[0]) - st["width"]) < TOL and abs((hi[1] - lo[1]) - st["depth"]) < TOL and abs((hi[2] - lo[2]) - st["height"]) < TOL,
                  "stage dimensions match configuration", f"{hi[0]-lo[0]:.3f} × {hi[1]-lo[1]:.3f} × {hi[2]-lo[2]:.3f} m")
    else:
        # A deck joined to the screen: measure its edges (bounding boxes of arcs are loose), then check the
        # trimmed edge is an exact arc of the screen's plan circle less the joint gap.
        brep = stage_obj.Geometry.ToBrep(True)
        pts = []
        for e in range(len(brep.Edges)):
            crv = brep.Edges[e]
            d0, d1 = crv.Domain.T0, crv.Domain.T1
            pts += [crv.PointAt(d0 + (d1 - d0) * k / 512) for k in range(513)]
        xs = [p.X for p in pts]
        ys = [p.Y for p in pts]
        zs = [p.Z for p in pts]
        w, d, h = max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)
        want_w = float(stage_obj.Attributes.GetUserString("om.plan_width_m"))
        want_d = float(stage_obj.Attributes.GetUserString("om.plan_depth_m"))
        rep.check(abs(w - want_w) < 1e-4 and abs(d - want_d) < 1e-4 and abs(h - st["height"]) < TOL,
                  "stage dimensions match configuration (deck joined to the screen)", f"{w:.3f} × {d:.3f} × {h:.3f} m")
        trim = float(stage_obj.Attributes.GetUserString("om.trim_radius_m"))
        far = max(math.hypot(p.X, p.Y) for p in pts)
        deck_top_z = max(zs) - stage_dz
        R0 = config["sphere"]["radius"]
        ring0 = config["sphere"].get("ringRadius", 0) or 0
        screen_r = ring0 + math.sqrt(max(0.0, R0 * R0 - deck_top_z * deck_top_z))
        rep.check(abs(far - trim) < 1e-6 and screen_r - trim >= 0.05 - 1e-6, "stage deck meets the screen on an exact arc, inside it",
                  f"edge radius {far:.4f} m, screen {screen_r:.4f} m at deck level")
    floor = config["floor"]["mainFloorElevation"]
    rep.check(abs(lo[2] - stage_dz - floor) < TOL, "stage sits on the main floor" + (" (before lowering)" if stage_dz else ""), f"z = {lo[2] - stage_dz:.4f}")
    tiers = [o for o in top if o.Attributes.GetUserString("om.category") == "SeatingTier"]
    def tier_bottom(o):
        v = o.Attributes.GetUserString("om.tier_bottom_z")
        return float(v) if v else floor
    bad = [o.Attributes.Name for o in tiers if abs(bbox(o.Geometry)[1][2] - pose_dz(o) - float(o.Attributes.GetUserString("om.tier_top_z"))) > 1e-4 or abs(bbox(o.Geometry)[0][2] - pose_dz(o) - tier_bottom(o)) > 1e-4]
    rep.check(tiers and not bad, f"{len(tiers)} tier platforms/decks span their stated bottom → tier top", ", ".join(bad))
    half = ring + R + config["envelope"]["serviceZone"]
    site = {"BuildingEnvelope", "Column", "Circulation", "SafetyVolume"}  # analysis volumes may extend past the venue
    # The opened proscenium carriage leaves the envelope by design (it needs a building pocket).
    on_carriage = lambda o: (o.Attributes.GetUserString("om.moved_by") or o.Attributes.GetUserString("om.assembly") or "").startswith("prosc") or o.Attributes.GetUserString("om.carriage_offset_m")
    outside = [o.Attributes.Name for o in top if o.Attributes.GetUserString("om.category") not in site and not on_carriage(o) and any(abs(x) > half + 1e-6 or abs(y) > half + 1e-6 for x, y, _ in exact_points(o.Geometry))]
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
            for o in units:
                x = o.Geometry.Xform
                d = pose(o)
                for sx in (-1, 1):
                    for sy in (-1, 1):
                        lx, ly = sx * led["unit"]["w"] / 2, sy * led["unit"]["h"] / 2
                        p = (x.M00 * lx + x.M01 * ly + x.M03 - d[0], x.M10 * lx + x.M11 * ly + x.M13 - d[1], x.M20 * lx + x.M21 * ly + x.M23 - d[2])
                        worst = max(worst, abs(tube(*p) - R))
            rep.check(abs(worst - led["maxDeviation"]) < 1e-6, "face corners deviate from the sphere by the reported maximum", f"{worst*1000:.2f} mm")
        else:
            worst = 0.0
            for o in units:
                srf = o.Geometry.Faces[0].UnderlyingSurface() if isinstance(o.Geometry, r.Brep) else None
                if srf is None:
                    worst = float("inf")
                    break
                du, dv = srf.Domain(0), srf.Domain(1)
                d = pose(o)
                for i in range(3):
                    for j in range(3):
                        p = srf.PointAt(du.T0 + (du.T1 - du.T0) * i / 2, dv.T0 + (dv.T1 - dv.T0) * j / 2)
                        worst = max(worst, abs(tube(p.X - d[0], p.Y - d[1], p.Z - d[2]) - R))
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

    bld = manifest.get("building")
    if bld:
        print("\nBuilding fit")
        b = config["building"]
        outline = by_id.get("bldg.outline.floor")
        if rep.check(outline is not None, "building outline present"):
            lo, hi = bbox(outline.Geometry)
            rep.check(abs(hi[0] - lo[0] - b["width"]) < 1e-6 and abs(hi[1] - lo[1] - b["depth"]) < 1e-6 and abs(lo[2] - b["floorElevation"]) < 1e-6,
                      f"outline is {b['width']} × {b['depth']} m at the structural floor")
        cols = [o for o in top if o.Attributes.GetUserString("om.category") == "Column"]
        rep.check(len(cols) == bld["columns"], f"{bld['columns']} columns", f"found {len(cols)}")
        R = config["sphere"]["radius"]
        service = ring + R + config["envelope"]["serviceZone"]
        wrong = []
        clashes = 0
        for o in cols:
            lo, hi = bbox(o.Geometry)
            dx = max(0.0, lo[0], -hi[0])
            dy = max(0.0, lo[1], -hi[1])
            d = math.hypot(dx, dy)
            st = o.Attributes.GetUserString("om.fit_status")
            clash = d < service
            clashes += clash
            if clash != (st in ("inside", "service")) or (st == "inside") != (d < ring + R):
                wrong.append(o.Attributes.Name)
            if abs(hi[2] - lo[2] - b["clearHeight"]) > 1e-6:
                wrong.append(o.Attributes.Name + " height")
        rep.check(not wrong, "column clash status matches its distance from the sphere centre", ", ".join(wrong[:5]))
        rep.check(clashes == bld["clashes"], f"{bld['clashes']} column clashes", f"found {clashes}")
        half = ring + R + config["envelope"]["serviceZone"]
        x0, x1 = b["offsetX"] - b["width"] / 2, b["offsetX"] + b["width"] / 2
        y0, y1 = b["offsetY"] - b["depth"] / 2, b["offsetY"] + b["depth"] / 2
        plan_ok = x0 <= -half + 1e-9 and x1 >= half - 1e-9 and y0 <= -half + 1e-9 and y1 >= half - 1e-9
        rep.check(not bld["fits"] or (plan_ok and clashes == 0), "a fit verdict means the envelope is inside the walls and no column clashes",
                  "fits" if bld["fits"] else "does not fit")

    sysm = manifest.get("systems")
    if sysm:
        print("\nFit-out and immersion systems")
        R = config["sphere"]["radius"]
        service = R + config["envelope"]["serviceZone"]
        units = [o for o in top if isinstance(o.Geometry, r.InstanceReference) and o.Attributes.GetUserString("om.system")]
        counts = {}
        for o in units:
            sid = o.Attributes.GetUserString("om.system")
            counts[sid] = counts.get(sid, 0) + 1
        expected = {k: v for k, v in sysm["units"].items() if k != "haptics"}
        placed = {k: counts.get(k, 0) for k in expected}
        # Lighting counts exclude truss metres; every other placed unit is one instance.
        rep.check(placed == expected, "placed units per system match the manifest", f"{placed} vs {expected}")
        wrong = []
        for o in units:
            x, y, z = exact_points(o.Geometry)[0]
            d = tube(x, y, z)
            cat = o.Attributes.GetUserString("om.category")
            if cat == "Speaker" and o.Attributes.GetUserString("om.ring") != "zenith" and not (R < d < service):
                wrong.append(f"{o.Attributes.Name} at {d:.2f}")
            if cat in ("LightingFixture", "Atmospherics", "Sensor") and d >= R:
                wrong.append(f"{o.Attributes.Name} outside the sphere")
        rep.check(not wrong, "speakers sit between the screen and the service zone; fixtures, hazers and sensors inside the sphere", ", ".join(wrong[:5]))
        rails = [o for o in top if o.Attributes.GetUserString("om.category") == "Guardrail"]
        def poly_length(g):
            pts = [g.Point(i) for i in range(g.PointCount)]
            return sum(math.dist((a.X, a.Y, a.Z), (b.X, b.Y, b.Z)) for a, b in zip(pts, pts[1:]))
        length = sum(poly_length(o.Geometry) for o in rails if isinstance(o.Geometry, r.PolylineCurve))
        # The rail is a polyline through the arc, so it is slightly shorter than the arc length.
        rep.check(abs(length - sysm["guardrailLength"]) <= 0.005 * max(1.0, sysm["guardrailLength"]), f"guardrails total {sysm['guardrailLength']:.2f} m", f"found {length:.3f} m")
        hoists = [o for o in units if o.Attributes.GetUserString("om.category") == "Hoist"]
        load = sum(float(o.Attributes.GetUserString("om.pick_load_kg") or 0) for o in hoists)
        rep.check(all(float(o.Attributes.GetUserString("om.pick_load_kg") or 0) > 0 for o in hoists), f"every hoist carries a pick-up load ({len(hoists)} hoists, {load/1000:.1f} t)")

    stm = manifest.get("structure")
    if stm:
        print("\nSupport structure")
        cat = lambda o: o.Attributes.GetUserString("om.category")
        ribs = [o for o in top if cat(o) == "Rib"]
        rings = [o for o in top if cat(o) in ("RingGirder", "BaseRing", "TopRing")]
        rep.check(len(ribs) == stm["segments"].get("rib", 0) and len(rings) == stm["segments"].get("ring", 0),
                  f"{len(ribs)} rib and {len(rings)} ring segments, as in the manifest")
        wrong = [o.Attributes.Name for o in ribs for x, y, z in exact_points(o.Geometry) if abs(tube(x, y, z) - stm["ribRadius"]) > 1e-6]
        rep.check(not wrong, f"every rib lies on the {stm['ribRadius']:.3f} m rib sphere (behind the screen)", ", ".join(wrong[:5]))
        R = config["sphere"]["radius"]
        rep.check(R < stm["ribRadius"] and stm["back"] <= R + config["envelope"]["serviceZone"] + 1e-9, "the structure sits between the screen and the service-zone limit",
                  f"back of structure {stm['back'] - R:.2f} m behind the screen")
        limits = {"container-20": 5.9, "container-40": 12.03, "trailer": 13.6}
        bad = []
        for o in ribs + rings:
            pts = exact_points(o.Geometry)
            chord = math.dist(pts[0], pts[1]) if len(pts) == 2 else 0
            ship = o.Attributes.GetUserString("om.shipping")
            if ship not in limits or chord > limits[ship] + 1e-6:
                bad.append(f"{o.Attributes.Name} {chord:.2f} m ({ship})")
        rep.check(not bad, "every rib and ring segment fits its shipping class (chord ≤ length)", ", ".join(bad[:5]))
        chains = [o for o in top if cat(o) == "Chain"]
        rep.check(len(chains) == stm["chains"], f"{stm['chains']} chains to pick beams, the crown grid or the roof", f"found {len(chains)}")
        nodes = [o for o in top if cat(o) == "StructureNode"]
        if "nodes" in stm and stm["nodes"] != stm["ribs"] * stm["rings"]:
            rep.check(len(nodes) == stm["nodes"], f"{stm['nodes']} node brackets (rib × ring, less the proscenium opening, plus its header)", f"found {len(nodes)}")
        else:
            rep.check(len(nodes) == stm["ribs"] * stm["rings"], f"one node bracket per rib × ring ({stm['ribs']} × {stm['rings']})", f"found {len(nodes)}")

    kin = manifest.get("transformation")
    if kin:
        print(f"\nTransformation ({manifest['state']} state)")
        paths = {o.Attributes.GetUserString("om.assembly"): o for o in top if o.Attributes.GetUserString("om.category") == "MotionPath"}
        moving = [a for a in kin["assemblies"] if any(a["travel"])]
        rep.check(len(paths) == len(moving) and all(a["id"] in paths for a in moving), f"one explicit motion path per moving assembly ({len(moving)} of {len(kin['assemblies'])})", f"found {len(paths)}")
        wrong = []
        for a in moving:
            g = paths.get(a["id"])
            # The proscenium halves run two straight legs (back, then aside): a two-segment polyline.
            want = r.PolylineCurve if a["kind"] == "proscenium" else r.LineCurve
            if g is None or not isinstance(g.Geometry, want):
                wrong.append(a["id"])
                continue
            p0, p1 = g.Geometry.PointAtStart, g.Geometry.PointAtEnd
            if math.dist((p1.X - p0.X, p1.Y - p0.Y, p1.Z - p0.Z), a["travel"]) > 1e-6:
                wrong.append(a["id"])
        rep.check(not wrong, "every path is straight legs adding up to its assembly's travel", ", ".join(wrong[:5]))
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
            wrong = [o.Attributes.Name for o in moved if math.dist(pose(o), travel[o.Attributes.GetUserString("om.moved_by")]) > 1e-6]
            rep.check(not wrong, "every moved object is offset by exactly its assembly's travel", ", ".join(wrong[:5]))
            rep.check(all(o.Attributes.GetUserString("om.folded") == "yes" for o in seats if o.Attributes.GetUserString("om.pose_offset")), "moved seats are marked folded")
            if config["transformation"]["stage"] == "lift":
                rep.check(abs(stage_top - floor) < TOL, "lowered stage is flush with the floor", f"top z = {stage_top:.4f}")
            rep.check(not [o for o in top if (o.Attributes.GetUserString("om.layer") or "").startswith("07_ANALYSIS/Sightline")], "no seated sightlines in the standing state")

    pr = config["transformation"].get("proscenium") or {}
    if pr.get("enabled"):
        print(f"\nRetractable proscenium ({manifest['state']} state, open {pr['open']})")
        layer_paths = [l.FullPath for l in model.Layers]
        pieces = [o for o in top if layer_paths[o.Attributes.LayerIndex].endswith("::Proscenium")]
        halves = {h: by_id.get(f"prosc.screen.{h}") for h in ("left", "right")}
        rep.check(all(halves.values()) and len(pieces) >= 3, f"two moving halves plus {len(pieces) - 2} fixed screen sections")
        area = sum(float(o.Attributes.GetUserString("om.area_m2")) for o in pieces)
        ideal = float(by_id["media.ideal"].Attributes.GetUserString("om.area_m2"))
        rep.check(abs(area - ideal) < 0.01, "the sections add up to the whole screen", f"{area:.2f} vs {ideal:.2f} m²")
        worst = 0.0
        for o in pieces:
            srf = o.Geometry.Faces[0].UnderlyingSurface()
            du, dv = srf.Domain(0), srf.Domain(1)
            d = pose(o)
            for i in range(9):
                for j in range(9):
                    p = srf.PointAt(du.T0 + (du.T1 - du.T0) * i / 8, dv.T0 + (dv.T1 - dv.T0) * j / 8)
                    worst = max(worst, abs(tube(p.X - d[0], p.Y - d[1], p.Z - d[2]) - R))
        rep.check(worst < 1e-9 * R, "every section is an exact patch of the screen surface (less its offset)", f"max |r - R| = {worst:.2e} m")
        # Expected pose from the Open setting: back by travel·min(1, 2u), then aside by slide·max(0, 2u − 1).
        timeline = config["transformation"]["enabled"] and pr["onTimeline"]
        u = pr["open"] if (not timeline or manifest["state"] == "standing") else 0.0
        bad = []
        for h, o in halves.items():
            if o is None:
                continue
            want = (float(o.Attributes.GetUserString("om.slide_m")) * max(0.0, 2 * u - 1), pr["travel"] * min(1.0, 2 * u), 0.0)
            if math.dist(pose(o), want) > 1e-6:
                bad.append(f"{h} at {pose(o)} not {want}")
            riders = [x for x in top if (x.Attributes.GetUserString("om.category") or "").startswith("LED") and (x.Attributes.GetUserString("om.moved_by") == f"prosc.{h}" or (x.Attributes.GetUserString("om.carriage_offset_m") and math.dist(pose(x), pose(o)) < 1e-9))]
            if any(math.dist(pose(x), pose(o)) > 1e-6 for x in riders):
                bad.append(f"{h} LED units off their half")
        rep.check(not bad, "halves sit where the Open setting puts them (back first, then aside) and their LED units ride with them", "; ".join(bad))

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
