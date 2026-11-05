import {pcmFromAudio} from './audio.js';
export const noteName=note=>`${['C','Cs','D','Ds','E','F','Fs','G','Gs','A','As','B'][note%12]}${Math.floor(note/12)-1}`;
export function recordingPlan(config) {
  const integer=(x,min,max,label)=>{const n=Number(x);if(!Number.isInteger(n)||n<min||n>max)throw Error(`${label}: ${min}–${max}`);return n;};
  const start=integer(config.start,0,127,'คีย์เริ่ม'),end=integer(config.end,0,127,'คีย์สุดท้าย');
  if(end<start)throw Error('คีย์สุดท้ายต้องไม่น้อยกว่าคีย์เริ่ม');
  const velocities=[...new Set(String(config.velocities).split(/[ ,]+/).filter(Boolean).map(v=>integer(v,1,127,'Velocity')))];
  if(!velocities.length || velocities.length>8)throw Error('ระบุ Velocity 1–8 ค่า');
  const repeats=integer(config.repeats,1,8,'จำนวนรอบ'),channel=integer(config.channel,1,16,'MIDI channel')-1;
  const seconds=(x,min,max,label)=>{const n=Number(x);if(!Number.isFinite(n)||n<min||n>max)throw Error(`${label}: ${min}–${max} วินาที`);return n;};
  const hold=seconds(config.hold,.1,30,'เวลากดคีย์'),tail=seconds(config.tail,.1,30,'เสียงหลังปล่อยคีย์'),gap=seconds(config.gap,.1,10,'ช่วงพัก');
  const tasks=[];
  for(let note=start;note<=end;note++)for(const velocity of velocities)for(let repeat=1;repeat<=repeats;repeat++)tasks.push({note,velocity,repeat,channel,hold,tail,gap,name:`key${String(note).padStart(3,'0')}_${noteName(note)}_v${velocity}_r${repeat}.wav`});
  if(tasks.length>2048)throw Error('แบ่งการบันทึกเป็นชุดละไม่เกิน 2048 เสียง');
  return tasks;
}
export function audioFromBlocks(blocks,rate) {
  if(!blocks.length)throw Error('ไม่ได้รับข้อมูลเสียงจากอุปกรณ์');
  const count=blocks[0].length,length=blocks.reduce((n,b)=>n+b[0].length,0);
  const channels=Array.from({length:count},()=>new Float32Array(length));let offset=0,peak=0;
  for(const block of blocks){if(block.length!==count)throw Error('จำนวนช่องเสียงเปลี่ยนระหว่างบันทึก');for(let c=0;c<count;c++){channels[c].set(block[c],offset);for(const x of block[c])peak=Math.max(peak,Math.abs(x));}offset+=block[0].length;}
  return {data:pcmFromAudio({length,numberOfChannels:count,sampleRate:rate,getChannelData:c=>channels[c]}),peak,frames:length,rate,channels:count};
}
export function panic(output,channel) {
  try{output.clear();output.send([0xb0|channel,64,0]);output.send([0xb0|channel,123,0]);output.send([0xb0|channel,120,0]);}catch{}
}
export async function recordNote(capture,output,task,signal) {
  if(signal?.aborted)throw new DOMException('หยุดแล้ว','AbortError');
  const preRoll=.15;
  try {
    return await capture.take(preRoll+task.hold+task.tail,()=>{
      if(signal?.aborted)throw new DOMException('หยุดแล้ว','AbortError');
      const at=performance.now()+preRoll*1000;
      output.send([0x90|task.channel,task.note,task.velocity],at);
      output.send([0x80|task.channel,task.note,0],at+task.hold*1000);
    },signal);
  }finally{panic(output,task.channel);}
}
export class AudioCapture {
  static async open(source) {
    let stream,ctx;
    try {
      if(source==='system') {
        if(window.desktop?.platform!=='win32')throw Error('บันทึกเสียงระบบได้ในแอป Windows เท่านั้น');
        stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      } else stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:source},echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
      if(!stream.getAudioTracks().length)throw Error('ไม่พบช่องเสียง กรุณาตั้ง Kontakt ให้ใช้ WASAPI/shared output หรือเลือก input loopback ที่ถูกต้อง');
      ctx=new AudioContext({sampleRate:48000});await ctx.resume();
      await ctx.audioWorklet.addModule(new URL('./capture-worklet.js',import.meta.url));
      return new AudioCapture(stream,ctx);
    }catch(e){stream?.getTracks().forEach(t=>t.stop());if(ctx)await ctx.close();throw e;}
  }
  constructor(stream,ctx) {
    this.stream=stream;this.ctx=ctx;this.sequence=0;
    this.node=new AudioWorkletNode(ctx,'pcm-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'});
    this.source=ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    this.mute=ctx.createGain();this.mute.gain.value=0;
    this.source.connect(this.node).connect(this.mute).connect(ctx.destination);
    this.node.port.onmessage=({data})=>{
      const p=this.pending;if(!p || p.id!==data.id)return;
      if(data.type==='armed'){try{p.armed();}catch(e){p.fail(e);}}
      if(data.type==='data')p.blocks.push(data.channels);
      if(data.type==='done'){try{p.finish(audioFromBlocks(p.blocks,ctx.sampleRate));}catch(e){p.fail(e);}}
    };
    stream.getAudioTracks().forEach(t=>t.addEventListener('ended',()=>this.pending?.fail(Error('อุปกรณ์บันทึกเสียงหยุดทำงาน'))));
  }
  take(seconds,armed,signal) {
    if(this.pending)throw Error('กำลังบันทึกเสียงอยู่');
    return new Promise((resolve,reject)=>{
      const id=++this.sequence;
      const clean=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.node.port.postMessage({type:'stop'});this.pending=null;};
      const fail=e=>{clean();reject(e);};
      const abort=()=>fail(new DOMException('หยุดแล้ว','AbortError'));
      const timer=setTimeout(()=>fail(Error('หมดเวลารับเสียง ตรวจสอบอุปกรณ์และการเชื่อมต่อ Kontakt')),seconds*1000+8000);
      this.pending={id,armed,blocks:[],fail,finish:result=>{clean();resolve(result);}};
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted){abort();return;}
      this.node.port.postMessage({type:'record',id,frames:Math.round(seconds*this.ctx.sampleRate)});
    });
  }
  async close() {
    this.pending?.fail(new DOMException('หยุดแล้ว','AbortError'));
    this.stream.getTracks().forEach(t=>t.stop());this.source.disconnect();this.node.disconnect();this.mute.disconnect();await this.ctx.close();
  }
}
