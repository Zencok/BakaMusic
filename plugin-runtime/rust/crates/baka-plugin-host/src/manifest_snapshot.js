// Reject values JSON.stringify would silently drop, coerce or customize.
(() => {
  const active = new Set();
  function snapshot(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || active.has(value)) throw Error('manifest must be acyclic JSON');
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw Error('manifest must contain plain JSON objects');
    if (Object.getOwnPropertySymbols(value).length) throw Error('manifest cannot contain symbol keys');
    active.add(value);
    const result = Array.isArray(value) ? [] : Object.create(null);
    if (Array.isArray(value)) {
      for (let i=0;i<value.length;i++) result.push(snapshot(value[i]));
    } else {
      for (const key of Object.keys(value)) result[key] = snapshot(value[key]);
    }
    active.delete(value);
    return result;
  }
  return snapshot(module.exports.manifest);
})()
