// Generated-source adapter only. Compatibility globals belong to this converted
// package's isolated QuickJS context; ordinary V2 packages do not install them.
function createLegacyLxAdapter(original, info) {
  let session;
  // Capture the native timers before publishing LX wrappers on this context.
  const nativeSetTimeout=setTimeout,nativeClearTimeout=clearTimeout;
  const evaluate = new Function('globalThis','window','self','global','lx','module','exports','require','Buffer','setTimeout','clearTimeout','setInterval','clearInterval','env', original);
  function initialize(sdk) {
    let handler, initialized=false, resolveReady, rejectReady;
    const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
    const sources=Object.create(null), pending=new Set(), timers=new Set();
    const delay=(fn,ms,...args)=>{
      const id=nativeSetTimeout(()=>{timers.delete(id);fn(...args);},Math.max(1,Math.min(60000,Number(ms)||1)));
      timers.add(id); return id;
    };
    const cancel=id=>{timers.delete(id);nativeClearTimeout(id);};
    const interval=(fn,ms,...args)=>{
      const token={active:true,id:null};
      const tick=()=>{if(token.active){fn(...args);if(token.active)token.id=delay(tick,ms);}};
      token.id=delay(tick,ms); return token;
    };
    const clearInterval=token=>{if(token){token.active=false;cancel(token.id);}};
    class Bytes extends Uint8Array {
      static from(value,encoding='utf8') {
        if(typeof value==='string') {
          const enc=String(encoding).toLowerCase();
          let hex;
          if(enc==='binary'||enc==='latin1'||enc==='ascii') hex=Array.from(value,c=>(c.charCodeAt(0)&255).toString(16).padStart(2,'0')).join('');
          else hex=sdk.bytes.encode(value,enc==='utf-8'?'utf8':enc);
          return new Bytes((hex.match(/../g)||[]).map(v=>parseInt(v,16)));
        }
        if(value instanceof ArrayBuffer) return new Bytes(value.slice(0));
        if(ArrayBuffer.isView(value)) return new Bytes(new Uint8Array(value.buffer,value.byteOffset,value.byteLength));
        if(Array.isArray(value)) return new Bytes(value);
        if(value&&value.type==='Buffer'&&Array.isArray(value.data))return new Bytes(value.data);
        throw new TypeError('LX buffer input is invalid');
      }
      static alloc(size,fill=0){if(!Number.isSafeInteger(size)||size<0||size>16777216)throw Error('LX buffer exceeds limit');return new Bytes(size).fill(fill);}
      static isBuffer(value){return value instanceof Bytes;}
      static concat(values){const length=values.reduce((n,v)=>n+v.length,0),out=Bytes.alloc(length);let offset=0;for(const v of values){out.set(v,offset);offset+=v.length;}return out;}
      toString(encoding='utf8',start=0,end=this.length){
        const value=Uint8Array.prototype.slice.call(this,start,end),enc=String(encoding).toLowerCase();
        if(enc==='binary'||enc==='latin1'||enc==='ascii')return Array.from(value,v=>String.fromCharCode(v)).join('');
        return sdk.bytes.decode(Array.from(value,v=>v.toString(16).padStart(2,'0')).join(''),enc==='utf-8'?'utf8':enc);
      }
      slice(start,end){return Bytes.from(Uint8Array.prototype.slice.call(this,start,end));}
    }
    const bytes=v=>Bytes.from(v), hex=v=>bytes(v).toString('hex');
    function rsaEncrypt(value,pem){
      const der=Bytes.from(pem.replace(/-----[^-]+-----/g,'').replace(/\s/g,''),'base64');
      function tlv(start){const tag=der[start++];let length=der[start++];if(length&128){const count=length&127;length=0;if(count>4)throw Error('Invalid RSA key');for(let i=0;i<count;i++)length=length*256+der[start++];}if(!Number.isFinite(length)||start+length>der.length)throw Error('Invalid RSA key');return {tag,start,end:start+length};}
      const outer=tlv(0);let n=tlv(outer.start);
      if(n.tag===48){const bit=tlv(n.end),seq=tlv(bit.start+1);n=tlv(seq.start);}
      if(n.tag!==2)throw Error('Invalid RSA modulus');
      const e=tlv(n.end),modulusHex=der.slice(n.start,n.end).toString('hex').replace(/^00/,''),size=modulusHex.length/2,input=bytes(value);
      if(input.length>size)throw Error('RSA input too large');
      const modulus=BigInt('0x'+modulusHex);let exponent=BigInt('0x'+der.slice(e.start,e.end).toString('hex')),base=input.length?BigInt('0x'+input.toString('hex')):0n,out=1n;
      if(base>=modulus)throw Error('RSA input exceeds modulus');
      while(exponent>0n){if(exponent&1n)out=out*base%modulus;base=base*base%modulus;exponent>>=1n;}
      return Bytes.from(out.toString(16).padStart(size*2,'0'),'hex');
    }
    const api={version:'2.0.0',env:'desktop',currentScriptInfo:Object.freeze({...info,rawScript:original}),
      EVENT_NAMES:Object.freeze({request:'request',inited:'inited',updateAlert:'updateAlert',showConfigView:'showConfigView'}),
      on(event,fn){if(!['request','showConfigView'].includes(event)||typeof fn!=='function')throw Error('Invalid LX handler');if(event==='request')handler=fn;return Promise.resolve();},
      send(event,data){
        if(event==='showConfigView'||event==='updateAlert')return Promise.resolve();
        if(event!=='inited'||initialized)throw Error('Invalid LX initialization event');
        if(!data||!data.sources||typeof data.sources!=='object'||Array.isArray(data.sources))throw Error('LX plugin sources are invalid');
        for(const source of ['kw','kg','tx','wy','mg']){
          const d=data.sources[source];
          if(!d||typeof d!=='object'||Array.isArray(d)||(d.type!==undefined&&d.type!=='music')||!Array.isArray(d.actions)||!d.actions.includes('musicUrl'))continue;
          const q=d.qualitys||d.qualities;
          if(Array.isArray(q)){const qualities=[...new Set(q.filter(v=>typeof v==='string'&&v.length>0&&v.length<64))];if(qualities.length)sources[source]={qualities};}
        }
        if(!Object.keys(sources).length)throw Error('LX has no musicUrl sources');
        initialized=true;resolveReady();return Promise.resolve();
      },
      request(url,options,callback){
        if(typeof url!=='string'||typeof callback!=='function')throw Error('Invalid LX request');
        options=options&&typeof options==='object'?options:{};
        const headers={};for(const [key,value] of Object.entries(options.headers||{})){if(!['string','number','boolean'].includes(typeof value))throw Error('Invalid LX header');headers[key]=String(value);}
        let body,bodyHex;
        const contentType=value=>{if(!Object.keys(headers).some(k=>k.toLowerCase()==='content-type'))headers['Content-Type']=value;};
        if(options.form){body=Object.entries(options.form).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(String(v))).join('&');contentType('application/x-www-form-urlencoded');}
        else if(options.formData){
          const boundary='----baka'+sdk.crypto.randomBytes(12);body=Object.entries(options.formData).map(([k,v])=>{if(/[\r\n\"]/.test(k))throw Error('Invalid multipart field');return '--'+boundary+'\r\nContent-Disposition: form-data; name="'+k+'"\r\n\r\n'+String(v)+'\r\n';}).join('')+'--'+boundary+'--\r\n';contentType('multipart/form-data; boundary='+boundary);
        }else if(options.body!=null){if(options.body instanceof ArrayBuffer||ArrayBuffer.isView(options.body))bodyHex=hex(options.body);else if(typeof options.body==='string')body=options.body;else{body=JSON.stringify(options.body);contentType('application/json');}}
        const operation={active:true};pending.add(operation);
        // Cancellation suppresses the callback. Native call/workspace cancellation still
        // owns transport shutdown; the current SDK has no per-request abort primitive.
        sdk.http.request({url,method:typeof options.method==='string'?options.method:'GET',headers,body,bodyHex,responseType:'bytes',timeoutMs:Math.max(1,Math.min(60000,Number(options.timeout)||15000))}).then(response=>{
          if(!operation.active)return;
          const raw=Bytes.from(response.body,'hex');let result=options.binary===true?raw:raw.toString('utf8');
          if(options.binary!==true){try{result=JSON.parse(result);}catch(_){}}
          callback(null,{statusCode:response.status,status:response.status,headers:response.headers,raw,bytes:raw.length,body:result},result);
        },error=>{if(operation.active)callback(error,null,null);}).catch(error=>sdk.log.error('LX callback failed',String(error))).finally(()=>{operation.active=false;pending.delete(operation);});
        return ()=>{operation.active=false;pending.delete(operation);};
      },
      utils:{buffer:{from:(v,e)=>Bytes.from(v,e),bufToString:(v,e='utf8')=>Bytes.from(v).toString(e)},crypto:{
        rsaEncrypt,md5:v=>sdk.crypto.hash('md5',hex(v)),randomBytes:n=>Bytes.from(sdk.crypto.randomBytes(n),'hex'),
        aesEncrypt:(v,mode,key,iv)=>{if(!/^aes-(128|192|256)-(cbc|ecb)$/.test(mode))throw Error('Unsupported AES mode');return Bytes.from(sdk.crypto.aesEncrypt({mode:mode.endsWith('cbc')?'cbc':'ecb',keyHex:hex(key),ivHex:iv==null?'':hex(iv),dataHex:hex(v),padding:'pkcs7'}),'hex');}
      },zlib:{inflate:async v=>Bytes.from(sdk.bytes.decompress(hex(v)),'hex'),deflate:async v=>Bytes.from(sdk.bytes.compress(hex(v)),'hex')}}
    };
    // Obfuscated LX scripts use indirect eval and Function constructors to find
    // their global object. A lexical facade alone cannot preserve those lookups.
    const facade=globalThis;Object.defineProperty(facade,'lx',{value:Object.freeze(api),enumerable:true});
    for(const key of ['globalThis','global','window','self'])Object.defineProperty(facade,key,{value:facade});
    Object.assign(facade,{Buffer:Bytes,setTimeout:delay,clearTimeout:cancel,setInterval:interval,clearInterval});
    Object.defineProperty(facade,'env',{value:sdk.settings,enumerable:true});
    const module={exports:{}};
    let startupError;
    try{evaluate.call(facade,facade,facade,facade,facade,api,module,module.exports,()=>{throw Error('LX scripts cannot import npm modules');},Bytes,delay,cancel,interval,clearInterval,sdk.settings);}catch(error){startupError=error;rejectReady(error);}
    const timeout=delay(()=>rejectReady(Error('LX initialization timed out')),10000);
    const initializedPromise=ready.then(()=>{cancel(timeout);if(startupError)throw startupError;if(typeof handler!=='function')throw Error('LX request handler missing');},error=>{cancel(timeout);throw error;});
    return {ready:initializedPromise,sources,call:request=>handler.call(api,request)};
  }
  return async function resolve(request,sdk){
    session=session||initialize(sdk);await session.ready;
    if(request.__bakaLxInitialize===true)return {sources:session.sources};
    const context=request.context;
    if(!context||context.protocol!=='lx'||typeof context.source!=='string'||!context.musicInfo||typeof context.musicInfo!=='object')throw Error('LX resolver requires provider-prepared context');
    const source=context.source==='qq'?'tx':context.source,quality=request.quality||context.quality;
    if(!session.sources[source]||!session.sources[source].qualities.includes(quality)){const e=Error('LX source or quality unsupported');e.code='quality_unavailable';throw e;}
    const result=await session.call({source,action:'musicUrl',info:{type:quality,musicInfo:context.musicInfo}});
    const value=typeof result==='string'?{url:result}:result;
    if(!value||typeof value.url!=='string'||value.url.length>8192)throw Error('LX returned invalid media URL');
    const url=new URL(value.url);if(!['http:','https:'].includes(url.protocol)||!url.hostname)throw Error('LX returned invalid media URL');
    return {...value,url:url.href};
  };
}
