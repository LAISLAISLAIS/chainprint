/**
 * In-session reference library — multiple analyzed tracks + blends.
 * Lives in memory for the page session (files can't persist to localStorage).
 */

function uid() {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * @typedef {object} LibraryEntry
 * @property {string} id
 * @property {'track' | 'blend'} kind
 * @property {string} name
 * @property {string | null} artwork
 * @property {object | null} meta
 * @property {{ kind: 'file', file: File } | { kind: 'url', url: string, manualQuery?: string } | { kind: 'blend' } | null} source
 * @property {File | Blob | null} [audioFile]
 * @property {object | null} result
 * @property {string[]} [blendOf]
 * @property {number} [weight]
 * @property {string} createdAt
 */

export function createLibrary() {
  /** @type {LibraryEntry[]} */
  const entries = [];
  let activeId = null;
  /** @type {Set<string>} */
  const blendPick = new Set();

  function list() {
    return entries.slice();
  }

  function get(id) {
    return entries.find((e) => e.id === id) || null;
  }

  function active() {
    return activeId ? get(activeId) : null;
  }

  function setActive(id) {
    if (!get(id)) return null;
    activeId = id;
    return get(id);
  }

  /**
   * @param {Partial<LibraryEntry> & { name: string }} partial
   */
  function add(partial) {
    const entry = {
      id: uid(),
      kind: partial.kind || "track",
      name: partial.name,
      artwork: partial.artwork ?? null,
      meta: partial.meta ?? null,
      source: partial.source ?? null,
      audioFile: partial.audioFile ?? null,
      result: partial.result ?? null,
      blendOf: partial.blendOf,
      weight: partial.weight,
      createdAt: new Date().toISOString(),
    };
    entries.push(entry);
    activeId = entry.id;
    return entry;
  }

  function update(id, patch) {
    const entry = get(id);
    if (!entry) return null;
    Object.assign(entry, patch);
    return entry;
  }

  function remove(id) {
    const i = entries.findIndex((e) => e.id === id);
    if (i < 0) return false;
    entries.splice(i, 1);
    blendPick.delete(id);
    // Drop blends that depended on this track
    for (let j = entries.length - 1; j >= 0; j--) {
      const e = entries[j];
      if (e.kind === "blend" && e.blendOf?.includes(id)) {
        blendPick.delete(e.id);
        entries.splice(j, 1);
      }
    }
    if (activeId === id) {
      activeId = entries.length ? entries[entries.length - 1].id : null;
    }
    return true;
  }

  function toggleBlendPick(id) {
    const entry = get(id);
    if (!entry || entry.kind === "blend") return Array.from(blendPick);
    if (blendPick.has(id)) {
      blendPick.delete(id);
    } else {
      if (blendPick.size >= 2) {
        // Keep most recent pick + new one
        const kept = Array.from(blendPick).slice(-1);
        blendPick.clear();
        kept.forEach((k) => blendPick.add(k));
      }
      blendPick.add(id);
    }
    return Array.from(blendPick);
  }

  function blendPicks() {
    return Array.from(blendPick)
      .map((id) => get(id))
      .filter(Boolean);
  }

  function clearBlendPicks() {
    blendPick.clear();
  }

  function canBlend() {
    return blendPick.size === 2;
  }

  return {
    list,
    get,
    active,
    setActive,
    add,
    update,
    remove,
    toggleBlendPick,
    blendPicks,
    clearBlendPicks,
    canBlend,
  };
}
