const ascii = (v, p, n) => String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset + p, n));
export function chunks(v, start, end) {
  const out = [];
  for (let p = start; p < end;) {
    if (p + 8 > end) throw Error('หัวข้อ chunk ไม่สมบูรณ์');
    const size = v.getUint32(p + 4, true), next = p + 8 + size;
    if (next > end) throw Error('ขนาด chunk เกินขอบเขตไฟล์');
    out.push({id: ascii(v,p,4), start:p+8, end:next});
    p = next + (size & 1);
  }
  return out;
}
export function wav(pcm, rate, channels = 1, bits = 16) {
  if (!Number.isInteger(rate) || rate < 1 || rate > 768000) throw Error('sample rate ไม่ถูกต้อง');
  const out = new Uint8Array(44 + pcm.length + (pcm.length & 1)), v = new DataView(out.buffer);
  const str = (p,s) => [...s].forEach((c,i)=>v.setUint8(p+i,c.charCodeAt(0)));
  str(0,'RIFF'); v.setUint32(4,out.length-8,true); str(8,'WAVE'); str(12,'fmt ');
  v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,channels,true);
  v.setUint32(24,rate,true); v.setUint32(28,rate*channels*bits/8,true);
  v.setUint16(32,channels*bits/8,true); v.setUint16(34,bits,true);
  str(36,'data'); v.setUint32(40,pcm.length,true); out.set(pcm,44); return out;
}
export function soundFontSamples(buffer) {
  const v = new DataView(buffer);
  if (v.byteLength < 12 || ascii(v,0,4)!=='RIFF' || ascii(v,8,4)!=='sfbk') throw Error('ไม่ใช่ไฟล์ SF2 แบบ RIFF sfbk');
  const end=v.getUint32(4,true)+8;
  if(end>v.byteLength || end<12) throw Error('ไฟล์ SF2 ไม่สมบูรณ์');
  const lists = chunks(v,12,end).filter(c=>c.id==='LIST');
  const find = (type,id) => {
    const list=lists.find(c=>c.end-c.start>=4 && ascii(v,c.start,4)===type);
    return list && chunks(v,list.start+4,list.end).find(c=>c.id===id);
  };
  const smpl=find('sdta','smpl'), shdr=find('pdta','shdr'), sm24=find('sdta','sm24');
  if(!smpl || !shdr || (shdr.end-shdr.start)%46 || shdr.end-shdr.start<46) throw Error('ไม่พบตาราง samples ที่สมบูรณ์');
  const results=[];
  for(let p=shdr.start;p<shdr.end-46;p+=46) {
    const name=ascii(v,p,20).split('\0')[0].trim() || 'sample';
    const start=v.getUint32(p+20,true), stop=v.getUint32(p+24,true), rate=v.getUint32(p+36,true), type=v.getUint16(p+44,true);
    if(type&0x8000) { results.push({name,error:'ROM sample ไม่มีเสียงฝังในไฟล์'}); continue; }
    if(![1,2,4,8].includes(type & ~0x10)) throw Error('รูปแบบ sample ไม่รองรับ');
    if(type & 0x10) {
      if(start>=stop || stop>smpl.end-smpl.start) throw Error('ตำแหน่ง SF3 sample ไม่ถูกต้อง: '+name);
      const compressed=buffer.slice(smpl.start+start,smpl.start+stop);
      if(compressed.byteLength<4 || ascii(new DataView(compressed),0,4)!=='OggS') throw Error('SF3 sample ไม่มีข้อมูล Ogg Vorbis: '+name);
      results.push({name,compressed,rate,rootKey:v.getUint8(p+40)}); continue;
    }
    if(start>=stop || stop*2>smpl.end-smpl.start) throw Error('ตำแหน่ง sample ไม่ถูกต้อง: '+name);
    if(sm24 && stop>sm24.end-sm24.start) throw Error('ข้อมูล 24-bit ไม่สมบูรณ์');
    const bits=sm24?24:16, pcm=new Uint8Array((stop-start)*bits/8);
    for(let i=start,j=0;i<stop;i++) {
      if(sm24) pcm[j++]=v.getUint8(sm24.start+i);
      pcm[j++]=v.getUint8(smpl.start+i*2); pcm[j++]=v.getUint8(smpl.start+i*2+1);
    }
    results.push({name,data:wav(pcm,rate,1,bits),note:`${rate} Hz · ${bits}-bit · ${type===2?'ช่องขวา':type===4?'ช่องซ้าย':'mono'} · root key ${v.getUint8(p+40)}`});
  }
  return results;
}
export function extractSF2(buffer) {
  const samples=soundFontSamples(buffer);
  if(samples.some(s=>s.compressed)) throw Error('ไฟล์นี้มี SF3 samples ต้องใช้ตัวถอดรหัส Ogg');
  return samples;
}
export async function extractSoundFont(buffer, decode) {
  const results=[];
  for(const sample of soundFontSamples(buffer)) {
    if(!sample.compressed) {results.push(sample);continue;}
    try {
      const audio=await decode(sample.compressed,sample.rate);
      results.push({name:sample.name,data:pcmFromAudio(audio),note:`SF3 → PCM 16-bit · ${audio.sampleRate} Hz · ${audio.numberOfChannels} ช่อง · root key ${sample.rootKey}`});
    } catch(e) {results.push({name:sample.name,error:`ถอดรหัส SF3 ไม่สำเร็จ: ${e.message}`});}
  }
  return results;
}
export function sfzSamples(text) {
  const clean=text.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  const base=[...clean.matchAll(/\bdefault_path\s*=\s*("[^"]*"|.*?)(?=\s+[\w]+\s*=|\s*<|\r?\n|$)/g)].map(m=>m[1].replace(/^"|"$/g,''));
  if(base.length>1) throw Error('SFZ ที่เปลี่ยน default_path หลายครั้งยังไม่รองรับ');
  if(/#include\b/.test(clean)) throw Error('SFZ ที่ใช้ #include ยังไม่รองรับ');
  return [...new Set([...clean.matchAll(/\bsample\s*=\s*("[^"]*"|.*?)(?=\s+[\w]+\s*=|\s*<|\r?\n|$)/g)].map(m=>((base[0]||'')+m[1].replace(/^"|"$/g,'').trim()).replaceAll('\\','/')))];
}
export function pcmFromAudio(audio) {
  const pcm=new Uint8Array(audio.length*audio.numberOfChannels*2), v=new DataView(pcm.buffer);
  const channels=Array.from({length:audio.numberOfChannels},(_,i)=>audio.getChannelData(i));
  for(let i=0;i<audio.length;i++) for(let c=0;c<channels.length;c++) {
    const x=Math.max(-1,Math.min(1,channels[c][i])); v.setInt16((i*channels.length+c)*2,Math.round(x*(x<0?32768:32767)),true);
  }
  return wav(pcm,audio.sampleRate,audio.numberOfChannels);
}
