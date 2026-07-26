/**
 * In-session reference library — multiple analyzed tracks + blends.
 * Analyze page persists this to IndexedDB so reloads keep your refs.
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

/**
 * @param {{ onChange?: () => void }} [opts]
 */
export function createLibrary(opts = {}) {
  /** @type {LibraryEntry[]} */
  const entries = [];
  let activeId = null;
  /** @type {Set<string>} */
  const blendPick = new Set();
  const onChange = typeof opts.onChange === "function" ? opts.onChange : null;

  function notify() {
    onChange?.();
  }

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
    notify();
    return get(id);
  }

  /**
   * @param {Partial<LibraryEntry> & { name: string }} partial
   */
  function add(partial) {
    const entry = {
      id: partial.id || uid(),
      kind: partial.kind || "track",
      name: partial.name,
      artwork: partial.artwork ?? null,
      meta: partial.meta ?? null,
      source: partial.source ?? null,
      audioFile: partial.audioFile ?? null,
      result: partial.result ?? null,
      blendOf: partial.blendOf,
      weight: partial.weight,
      createdAt: partial.createdAt || new Date().toISOString(),
    };
    entries.push(entry);
    activeId = entry.id;
    notify();
    return entry;
  }

  function update(id, patch) {
    const entry = get(id);
    if (!entry) return null;
    Object.assign(entry, patch);
    // Track updates must not keep stale blend metadata (Object.assign won't clear it)
    if (entry.kind !== "blend") {
      delete entry.blendOf;
      delete entry.weight;
    }
    notify();
    return entry;
  }

  function remove(id) {
    if (!id || typeof id !== "string") return false;
    if (!entries.some((e) => e.id === id)) return false;

    // Keep everything except this id and blends that explicitly depend on it
    const kept = entries.filter((e) => {
      if (e.id === id) return false;
      if (
        e.kind === "blend" &&
        Array.isArray(e.blendOf) &&
        e.blendOf.includes(id)
      ) {
        blendPick.delete(e.id);
        return false;
      }
      return true;
    });
    entries.length = 0;
    entries.push(...kept);
    blendPick.delete(id);

    if (activeId === id || !get(activeId)) {
      activeId = entries.length ? entries[entries.length - 1].id : null;
    }
    notify();
    return true;
  }

  /**
   * Replace in-memory library from a persisted snapshot.
   * @param {LibraryEntry[]} nextEntries
   * @param {string | null} [nextActiveId]
   */
  function hydrate(nextEntries, nextActiveId = null) {
    entries.length = 0;
    for (const e of nextEntries || []) {
      if (e?.id) entries.push(e);
    }
    blendPick.clear();
    activeId =
      nextActiveId && get(nextActiveId)
        ? nextActiveId
        : entries.length
          ? entries[entries.length - 1].id
          : null;
    // No notify — caller is restoring, not mutating
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
    notify();
    return Array.from(blendPick);
  }

  function blendPicks() {
    return Array.from(blendPick)
      .map((id) => get(id))
      .filter(Boolean);
  }

  function clearBlendPicks() {
    blendPick.clear();
    notify();
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
    hydrate,
    toggleBlendPick,
    blendPicks,
    clearBlendPicks,
    canBlend,
  };
}
