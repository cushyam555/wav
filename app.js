import {extractSF2,sfzSamples,pcmFromAudio} from './audio.js';
import {zip} from './zip.js';
const input=document.querySelector('#files'),drop=document.querySelector('#drop'),list=document.querySelector('#results'),status=document.querySelector('#status'),download=document.querySelector('#download');
let outputs=[],urls=[],busy=false;
const safe=s=>s.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/^\.+/,'_').slice(0,150)||'sample';
function row(message,error=false,data,name){
  const li=document.createElement('li');li.className=error?'error':'';li.textContent=message;
  if(data){const a=document.createElement('a');const url=URL.createObjectURL(new Blob([data],{type:'audio/wav'}));urls.push(url);a.href=url;a.download=name;a.textContent='ดาวน์โหลด';li.append(a);}list.append(li);
}
function add(source,sample){
  if(sample.error){row(`${source}: ${sample.name} — ${sample.error}`,true);return;}
  const name=`${String(outputs.length+1).padStart(4,'0')}_${safe(source.replace(/\.[^.]+$/,''))}_${safe(sample.name.replace(/\.wav$/i,''))}.wav`;
  outputs.push({name,data:sample.data});row(`${sample.name} — ${sample.note||'WAV'}`,false,sample.data,name);
}
async function convert(file){
  const buffer=await file.arrayBuffer();
  if(/\.wav$/i.test(file.name)){
    const v=new Uint8Array(buffer);if(String.fromCharCode(...v.slice(0,4))!=='RIFF'||String.fromCharCode(...v.slice(8,12))!=='WAVE')throw Error('ไม่ใช่ WAV แบบ RIFF');
    add(file.name,{name:file.name,data:v,note:'คัดลอก WAV ต้นฉบับ'});return;
  }
  const ctx=new AudioContext();
  try{const audio=await ctx.decodeAudioData(buffer);add(file.name,{name:file.name,data:pcmFromAudio(audio),note:`PCM 16-bit · ${audio.sampleRate} Hz (sample rate ของเบราว์เซอร์)`});}
  catch{throw Error('เบราว์เซอร์อ่านเสียงชนิดนี้ไม่ได้ หรือไฟล์ไม่สมบูรณ์');}finally{await ctx.close();}
}
async function run(files){
  if(busy)return;busy=true;input.disabled=true;download.disabled=true;urls.forEach(u=>URL.revokeObjectURL(u));urls=[];outputs=[];list.replaceChildren();status.textContent='กำลังแยกเสียง…';
  try{
    for(const file of files){
      status.textContent=`กำลังอ่าน ${file.name}`;await new Promise(r=>setTimeout(r,0));
      try{
        if(/\.sf2$/i.test(file.name)){for(const s of extractSF2(await file.arrayBuffer()))add(file.name,s);}
        else if(/\.sfz$/i.test(file.name)){
          const paths=sfzSamples(await file.text());if(!paths.length)throw Error('ไม่พบ sample ใน SFZ');
          for(const path of paths){
            if(path.startsWith('*')){row(`${path}: เป็นเสียงสังเคราะห์ ไม่มีไฟล์เสียง`,true);continue;}
            const matches=files.filter(f=>f.name.toLowerCase()===path.split('/').pop().toLowerCase());
            if(matches.length!==1){row(`${file.name}: ${path} — ${matches.length?'ชื่อไฟล์ซ้ำ ระบุไม่ได้':'กรุณาเลือกไฟล์เสียงนี้มาพร้อม SFZ'}`,true);continue;}
            try{await convert(matches[0]);}catch(e){row(`${path}: ${e.message}`,true);}
          }
        }else if(/\.(wav|aif|aiff|mp3|ogg|flac|m4a|aac)$/i.test(file.name))await convert(file);
        else row(`${file.name}: ยังไม่รองรับรูปแบบนี้`,true);
      }catch(e){row(`${file.name}: ${e.message}`,true);}
    }
  }finally{busy=false;input.disabled=false;download.disabled=!outputs.length;status.textContent=`เสร็จแล้ว: ${outputs.length} ไฟล์ WAV · ข้อผิดพลาด/รายการข้าม ${list.querySelectorAll('.error').length}`;input.value='';}
}
input.addEventListener('change',()=>run([...input.files]));
drop.addEventListener('keydown',e=>{if(e.target===drop&&(e.key==='Enter'||e.key===' ')){e.preventDefault();input.click();}});
for(const event of ['dragover','dragleave','drop'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.toggle('over',event==='dragover');if(event==='drop')run([...e.dataTransfer.files]);});
download.addEventListener('click',()=>{try{const url=URL.createObjectURL(zip(outputs));urls.push(url);const a=document.createElement('a');a.href=url;a.download='samples.zip';a.click();}catch(e){row(e.message,true);}});
