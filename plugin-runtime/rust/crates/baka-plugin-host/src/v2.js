// V2 exposes native services without requiring compatibility/npm modules.
globalThis.__baka_v2_install = function (plugin, manifest) {
  // Native PackageManifest validation owns the entire wire contract.
  const m = manifest;
  const handlers = Object.create(null);
  for (const cap of m.capabilities) {
    let owner = plugin.handlers;
    const parts = cap.split('.');
    for (let i=0;i<parts.length-1;i++) owner = owner && owner[parts[i]];
    const fn = owner && owner[parts[parts.length-1]];
    if (typeof fn !== 'function') throw new Error('missing V2 handler: ' + cap);
    handlers[cap] = fn.bind(owner);
  }
  const storage = (operation, ...args) => {
    const fn = __baka['storage_' + operation];
    if (typeof fn !== 'function') return Promise.reject(new Error('plugin storage is not configured'));
    return fn(...args);
  };
  const aes = (operation, o) => __baka[operation](o.mode, o.keyHex, o.ivHex || '', o.dataHex, o.padding || 'pkcs7');
  const sdk = Object.freeze({
    http: Object.freeze({async request(o) {
      if (!o || typeof o.url !== 'string') throw new Error('HTTP url required');
      const r = JSON.parse(await __baka.http(JSON.stringify({url:o.url,method:o.method || 'GET',headers:o.headers || {},body:o.body,body_hex:o.bodyHex,timeout_ms:o.timeoutMs,want_bytes:o.responseType === 'bytes',want_text:o.responseType === 'text',max_redirects:o.maxRedirects})));
      if (r.kind === 'error') throw new Error(r.message || r.data || 'HTTP request failed');
      let body = r.data;
      if ((o.responseType === 'json' || (!o.responseType && r.kind === 'json')) && typeof body === 'string') body = JSON.parse(body);
      return {status:r.status,headers:r.headers,body};
    }}),
    bytes: Object.freeze({encode:(value,encoding='utf8')=>__baka.bytes_encode(value,encoding),decode:(hex,encoding='utf8')=>__baka.bytes_decode(hex,encoding),compress:(hex,format='zlib')=>{if(format!=='zlib')throw new Error('unsupported compression');return __baka.deflate_zlib(hex);},decompress:(hex,format='zlib')=>{if(format!=='zlib')throw new Error('unsupported compression');return __baka.inflate_zlib(hex,false);}}),
    text: Object.freeze({decodeHtml:value=>__baka.html_decode(value)}),
    crypto: Object.freeze({hash(algorithm,dataHex) { if (!['md5','sha1','sha256','sm3'].includes(algorithm)) throw new Error('unsupported hash'); return __baka[algorithm](dataHex); },hmacSha256:(keyHex,dataHex)=>__baka.hmac_sha256(keyHex,dataHex),randomBytes:n=>__baka.random_bytes(n),aesEncrypt:o=>aes('aes_encrypt',o),aesDecrypt:o=>aes('aes_decrypt',o)}),
    storage: Object.freeze({get:key=>storage('get',key),set:(key,value)=>{if(typeof value !== 'string') throw new Error('storage value must be a string');return storage('set',key,value);},remove:key=>storage('remove',key)}),
    settings: Object.freeze({...globalThis.env}),
    log: Object.freeze({debug:console.debug,info:console.info,warn:console.warn,error:console.error})
  });
  globalThis.__baka_v2_dispatch = async (cap,request) => {
    if (!Object.prototype.hasOwnProperty.call(handlers,cap)) throw new Error('unsupported V2 capability: ' + cap);
    return await handlers[cap](request,sdk);
  };
  return undefined;
};
