import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {recordingPlan,audioFromBlocks,recordNote,panic,noteName} from '../recording.js';
const config={start:60,end:61,velocities:'40,100,40',repeats:2,channel:2,hold:1,tail:.5,gap:.1};
test('recording plan covers every key, velocity and repetition with unique filenames',()=>{
 const tasks=recordingPlan(config);assert.equal(tasks.length,8);assert.equal(new Set(tasks.map(t=>t.name)).size,8);
 assert.deepEqual(tasks.map(t=>t.note),[60,60,60,60,61,61,61,61]);assert.equal(tasks[0].channel,1);assert.equal(noteName(60),'C4');assert.equal(noteName(0),'C-1');
});
test('invalid ranges, durations and velocities fail before sending MIDI',()=>{
 for(const change of [{end:59},{start:-1},{velocities:'0'},{velocities:''},{channel:17},{hold:0},{tail:Infinity},{repeats:1.1},{gap:-1}])assert.throws(()=>recordingPlan({...config,...change}));
});
test('recorded blocks are stereo PCM in chronological order and include peak',()=>{
 const r=audioFromBlocks([[new Float32Array([.25,-.5]),new Float32Array([.5,-1])],[new Float32Array([0]),new Float32Array([.1])]],48000);
 assert.equal(r.frames,3);assert.equal(r.channels,2);assert.equal(r.peak,1);
 const v=new DataView(r.data.buffer);assert.equal(v.getUint32(40,true),12);assert.equal(v.getInt16(50,true),-32768);
 assert.throws(()=>audioFromBlocks([],48000));
});
test('MIDI note on/off are scheduled with hold duration and panic releases sustain',async()=>{
 const events=[];let seconds;
 const output={send:(...args)=>events.push(args),clear:()=>events.push(['clear'])};
 const task=recordingPlan(config)[0];
 const capture={take:async(s,armed)=>{seconds=s;armed();return {peak:.5};}};
 const result=await recordNote(capture,output,task);
 assert.equal(result.peak,.5);assert.equal(seconds,1.65);
 assert.deepEqual(events[0][0],[0x91,60,40]);assert.deepEqual(events[1][0],[0x81,60,0]);assert.ok(Math.abs(events[1][1]-events[0][1]-1000)<1e-6);
 assert.deepEqual(events.at(-3)[0],[0xb1,64,0]);assert.deepEqual(events.at(-1)[0],[0xb1,120,0]);
});
test('cancellation sends all notes off even when capture fails',async()=>{
 const events=[];const output={send:x=>events.push(x),clear:()=>{}};
 await assert.rejects(recordNote({take:async()=>{throw new DOMException('stop','AbortError');}},output,recordingPlan(config)[0]),{name:'AbortError'});
 assert.deepEqual(events.at(-1),[0xb1,120,0]);
 const c=new AbortController();c.abort();await assert.rejects(recordNote({},output,recordingPlan(config)[0],c.signal),{name:'AbortError'});
 panic({send:()=>{throw Error('disconnected');},clear:()=>{}},0);
});
test('audio worklet captures exact frame counts, outputs silence and stops on cancel',async()=>{
 let Processor;const messages=[];
 const context={AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m)};}},registerProcessor:(_name,p)=>{Processor=p;}};
 vm.runInNewContext(await readFile(new URL('../capture-worklet.js',import.meta.url),'utf8'),context);
 const p=new Processor();p.port.onmessage({data:{type:'record',id:1,frames:150}});
 const block=[new Float32Array(128).fill(.5),new Float32Array(128).fill(-.25)],output=[new Float32Array(128).fill(1)];
 p.process([block],[output]);p.process([block],[output]);p.process([block],[output]);
 assert.equal(messages.filter(m=>m.type==='armed').length,1);assert.deepEqual(messages.filter(m=>m.type==='data').map(m=>m.channels[0].length),[128,22]);
 assert.equal(messages.at(-1).type,'done');assert.equal(output[0][0],0);
 p.port.onmessage({data:{type:'record',id:2,frames:1000}});p.port.onmessage({data:{type:'stop'}});const n=messages.length;p.process([block],[output]);assert.equal(messages.length,n);
});
