// Minimal entry bridge. No Buffer, axios, LX, DOM or compatibility packages.
(function(){
  let sequence=0;
  const timers=new Set();
  globalThis.setTimeout=(fn,ms,...args)=>{
    if(typeof fn!=='function')throw new TypeError('Timer callback must be a function');
    const id=++sequence;
    timers.add(id);
    __baka.timer_wait(id,Math.max(1,Math.min(60000,Number(ms)||1))).then(active=>{
      const present=timers.delete(id);
      if(active&&present)fn(...args);
    });
    return id;
  };
  globalThis.clearTimeout=id=>{if(timers.delete(Number(id)))__baka.timer_cancel(Number(id));};
})();
globalThis.__baka_call_entry = async function(name,args) {
  const result = await __baka_v2_dispatch(name,args[0] || {});
  if (name === 'lyrics.get' && result && typeof result === 'object') {
    for (const key of ['rawLrc','translation','romanization']) {
      if (typeof result[key] === 'string') result[key] = __baka.lyric_decode(result[key]);
    }
    try {
      Object.assign(result,JSON.parse(__baka.lyric_parse(result.rawLrc || '',result.translation || null,result.romanization || null,args[0]?.entity?.artist || null)));
      result.parserBackend='rust'; result.decryptBackend='rust';
    } catch (error) { result.parseError=String(error); }
  }
  return JSON.stringify(result === undefined ? null : result);
};
