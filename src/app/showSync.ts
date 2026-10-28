/**
 * Keeps the live show and the active alternative together (Round 09): switching alternatives loads
 * that alternative's show, and edits to the show are saved back into it (and so into the project file).
 */
import { normalizeShow } from '../show/definition';
import { toDefinition, useShow, type ShowState } from '../show/store';
import { useStudio } from './store';

const SAVED: (keyof ShowState)[] = ['presetId', 'video', 'mapping', 'audio', 'tempo', 'palette', 'lights', 'pulse', 'haze', 'intensity', 'cuesOn', 'cues', 'matrix'];

let loading = false;
const loadActive = () => {
  loading = true;
  useShow.getState().load(normalizeShow(useStudio.getState().config.show));
  loading = false;
};
loadActive();

useStudio.subscribe((s, prev) => {
  if (s.config.id !== prev.config.id) loadActive();
});

let timer: ReturnType<typeof setTimeout> | undefined;
useShow.subscribe((s, prev) => {
  if (loading || SAVED.every((k) => s[k] === prev[k])) return;
  clearTimeout(timer);
  timer = setTimeout(() => useStudio.getState().setShow(toDefinition(useShow.getState())), 300);
});
