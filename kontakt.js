import {recordingPlan,recordNote,panic,AudioCapture} from './recording.js';
const $=id=>document.getElementById(id);
for(const mode of ['extract','kontakt'])$(`tab-${mode}`).onclick=()=>{
  for(const m of ['extract','kontakt']){$(`${m}-panel`).hidden=m!==mode;$(`tab-${m}`).setAttribute('aria-pressed',String(m===mode));}
};
let midi,folder,controller,busy=false,testPassed=false,preview,activeOutput,activeChannel;
window.addEventListener('beforeunload',()=>{controller?.abort();if(activeOutput)panic(activeOutput,activeChannel);});
const settings=['midi-output','midi-channel','audio-source','test-note','note-start','note-end','velocities','repeats','hold','tail','gap'];
const status=text=>{$('kontakt-status').textContent=text;};
function config(){return {start:$('note-start').value,end:$('note-end').value,velocities:$('velocities').value,repeats:$('repeats').value,channel:$('midi-channel').value,hold:$('hold').value,tail:$('tail').value,gap:$('gap').value};}
function estimate(){try{const tasks=recordingPlan(config()),seconds=tasks.reduce((s,t)=>s+t.hold+t.tail+t.gap+.15,0);$('estimate').textContent=`${tasks.length} ไฟล์ · เวลาประมาณ ${Math.ceil(seconds/60)} นาที · WAV ประมาณ ${Math.ceil(tasks.reduce((s,t)=>s+(t.hold+t.tail+.15)*48000*4,0)/1024/1024)} MB`;}catch(e){$('estimate').textContent=e.message;}}
for(const id of settings)$(id).addEventListener('change',()=>{testPassed=false;estimate();});
estimate();
$('desktop-note').textContent=window.desktop?.platform==='win32'?'พร้อมใช้เสียงระบบ Windows หรือ audio input loopback':'โหมดเสียงระบบและการบันทึกลงโฟลเดอร์ต้องเปิดจากแอป Windows .exe';
function lock(active){busy=active;for(const id of [...settings,'refresh-midi','test-kontakt','choose-folder','start-kontakt'])$(id).disabled=active;$('stop-kontakt').disabled=!active;}
function log(text,error=false){const li=document.createElement('li');li.textContent=text;li.className=error?'error':'';$('record-results').prepend(li);}
function selectedOutput(){const out=midi?.outputs.get($('midi-output').value);if(!out || out.state==='disconnected')throw Error('ไม่พบ MIDI output กรุณาเปิด loopMIDI แล้วค้นหาใหม่');return out;}
async function refresh(){
  if(busy)return;
  try {
    if(!navigator.requestMIDIAccess)throw Error('ระบบนี้ไม่รองรับ MIDI ให้ใช้โปรแกรม Windows .exe');
    midi=await navigator.requestMIDIAccess({sysex:false});
    const select=$('midi-output'),previous=select.value;select.replaceChildren();
    for(const out of midi.outputs.values())select.add(new Option(out.name||out.id,out.id));
    if([...select.options].some(o=>o.value===previous))select.value=previous;
    if(!select.options.length)select.add(new Option('ไม่พบพอร์ต MIDI — เปิด loopMIDI ก่อน',''));
    const source=$('audio-source'),saved=source.value;source.replaceChildren(new Option('เสียงระบบ Windows (loopback)','system'));
    for(const device of await navigator.mediaDevices.enumerateDevices())if(device.kind==='audioinput')source.add(new Option(device.label||`Audio input ${source.options.length}`,device.deviceId));
    if([...source.options].some(o=>o.value===saved))source.value=saved;
    midi.onstatechange=()=>{testPassed=false;if(busy){try{selectedOutput();}catch{controller?.abort();status('MIDI หลุด กรุณาเชื่อมต่อแล้วทดสอบใหม่');}}};
    testPassed=false;status(`พบ MIDI ${midi.outputs.size} พอร์ต เลือกพอร์ตที่ Kontakt รับอยู่แล้วทดสอบ`);
  }catch(e){status(e.message);}
}
$('refresh-midi').onclick=refresh;
$('choose-folder').onclick=async()=>{try{if(!window.desktop)throw Error('เปิดจากโปรแกรม Windows .exe เพื่อเลือกโฟลเดอร์');const chosen=await window.desktop.chooseRecordingFolder();if(chosen){folder=chosen;$('folder-name').textContent=folder;}}catch(e){status(e.message);}};
$('stop-kontakt').onclick=()=>controller?.abort();
const wait=(ms,signal)=>new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);reject(new DOMException('หยุดแล้ว','AbortError'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
});
async function run(test) {
  if(busy)return;
  let capture,out,channel,manifest;
  try {
    const tasks=recordingPlan(test?{...config(),start:$('test-note').value,end:$('test-note').value,velocities:'100',repeats:1}:config());
    out=selectedOutput();channel=tasks[0].channel;
    if(!test && !testPassed)throw Error('กรุณาทดสอบเสียง 1 คีย์ให้ผ่านก่อนเริ่มทั้งชุด');
    if(!test && !folder)throw Error('กรุณาเลือกโฟลเดอร์ WAV ก่อน');
    activeOutput=out;activeChannel=channel;
    controller=new AbortController();lock(true);
    await window.desktop?.recordingActive(true);
    status('กำลังเปิดแหล่งบันทึกเสียง…');
    capture=await AudioCapture.open($('audio-source').value);
    if(controller.signal.aborted)throw new DOMException('หยุดแล้ว','AbortError');
    await out.open();panic(out,channel);
    // Let the audio driver and Kontakt settle before the first note.
    await wait(500,controller.signal);
    manifest={version:'1.1.0',started:new Date().toISOString(),midiOutput:out.name,source:$('audio-source').selectedOptions[0].textContent,config:config(),preRollSeconds:.15,files:[],status:'recording'};
    if(!test)await window.desktop.saveManifest(JSON.stringify(manifest,null,2));
    $('record-progress').max=tasks.length;$('record-progress').value=0;
    for(const [i,task] of tasks.entries()) {
      status(`${test?'ทดสอบ':'กำลังบันทึก'} ${i+1}/${tasks.length}: ${task.name}`);
      const result=await recordNote(capture,out,task,controller.signal);
      if(result.peak<.00001)throw Error(`คีย์ ${task.note} ได้เสียงเงียบ ตรวจ MIDI channel, ช่วงคีย์, Kontakt output และแหล่งบันทึกเสียง`);
      if(test) {
        if(preview)URL.revokeObjectURL(preview);
        preview=URL.createObjectURL(new Blob([result.data],{type:'audio/wav'}));$('test-playback').src=preview;$('test-playback').hidden=false;testPassed=true;
        status(`ทดสอบรับเสียงสำเร็จ · peak ${(20*Math.log10(result.peak)).toFixed(1)} dBFS · ฟังไฟล์ทดสอบก่อนเริ่มทั้งชุด`);
      } else {
        if(controller.signal.aborted)throw new DOMException('หยุดแล้ว','AbortError');
        await window.desktop.saveRecording(task.name,result.data);
        manifest.files.push({...task,sampleRate:result.rate,frames:result.frames,channels:result.channels,peak:result.peak});
        await window.desktop.saveManifest(JSON.stringify(manifest,null,2));
        log(`${task.name} · ${result.rate} Hz${result.peak>=.999?' · เตือน: เสียงใกล้ clipping ลด volume ใน Kontakt':''}`);
      }
      $('record-progress').value=i+1;
      if(i<tasks.length-1)await wait(task.gap*1000,controller.signal);
    }
    if(!test){manifest.status='complete';status(`เสร็จแล้ว ${manifest.files.length} ไฟล์ WAV · ${folder}`);folder=null;$('folder-name').textContent='เลือกโฟลเดอร์อีกครั้งสำหรับชุดถัดไป';}
  }catch(e){
    if(test)testPassed=false;
    if(manifest)manifest.status=e.name==='AbortError'?'stopped':'failed';
    const text=e.name==='AbortError'?`หยุดแล้ว · บันทึกสำเร็จ ${manifest?.files.length||0} ไฟล์`:`${e.message} · บันทึกสำเร็จ ${manifest?.files.length||0} ไฟล์`;
    status(text);log(text,true);
    if(!test && manifest){folder=null;$('folder-name').textContent='ไฟล์ที่สำเร็จอยู่ในโฟลเดอร์เดิม เลือกโฟลเดอร์ใหม่เพื่อเริ่มชุดถัดไป';}
  }finally{
    if(out && channel!==undefined)panic(out,channel);
    if(capture)await capture.close().catch(()=>{});
    if(!test && manifest){manifest.finished=new Date().toISOString();await window.desktop.saveManifest(JSON.stringify(manifest,null,2)).catch(e=>log(`บันทึก manifest ไม่สำเร็จ: ${e.message}`,true));}
    await window.desktop?.recordingActive(false).catch(()=>{});
    controller=null;activeOutput=null;lock(false);
  }
}
$('test-kontakt').onclick=()=>run(true);
$('start-kontakt').onclick=()=>run(false);
