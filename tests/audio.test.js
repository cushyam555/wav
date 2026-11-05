import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractSF2,sfzSamples,pcmFromAudio} from '../audio.js';
import {zip} from '../zip.js';
import {writeFile} from 'node:fs/promises';
function chunk(id,data){const b=Buffer.alloc(8+data.length+(data.length%2));b.write(id);b.writeUInt32LE(data.length,4);data.copy(b,8);return b;}
function fixture(bits=16){
 const h=Buffer.alloc(92);h.write('Piano');h.writeUInt32LE(0,20);h.writeUInt32LE(3,24);h.writeUInt32LE(22050,36);h[40]=60;h.writeUInt16LE(1,44);h.write('EOS',46);
 const pcm=Buffer.alloc(6);pcm.writeInt16LE(-32768,0);pcm.writeInt16LE(0,2);pcm.writeInt16LE(32767,4);
 const sd=chunk('LIST',Buffer.concat([Buffer.from('sdta'),chunk('smpl',pcm),...(bits===24?[chunk('sm24',Buffer.from([1,2,3]))]:[])]));
 const pd=chunk('LIST',Buffer.concat([Buffer.from('pdta'),chunk('shdr',h)]));
 const b=chunk('RIFF',Buffer.concat([Buffer.from('sfbk'),sd,pd]));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
}
test('SF2 exports exact signed PCM, rate and sample name',()=>{
 const [s]=extractSF2(fixture());const v=new DataView(s.data.buffer);
 assert.equal(s.name,'Piano');assert.equal(v.getUint32(24,true),22050);assert.equal(v.getInt16(44,true),-32768);assert.equal(v.getInt16(48,true),32767);assert.equal(s.data.length,50);
});
test('SF2 24-bit preserves low bytes in little endian order',()=>{
 const [s]=extractSF2(fixture(24));assert.deepEqual([...s.data.slice(44,53)],[1,0,128,2,0,0,3,255,127]);assert.equal(s.data.length,54);assert.equal(new DataView(s.data.buffer).getUint16(34,true),24);
});
test('truncated and invalid SF2 are rejected',()=>{
 assert.throws(()=>extractSF2(fixture().slice(0,-1)));assert.throws(()=>extractSF2(new ArrayBuffer(12)));
 const b=fixture();new DataView(b).setUint32(16,0xffffffff,true);assert.throws(()=>extractSF2(b));
});
test('SFZ handles spaces, default path, comments and duplicate samples',()=>{
 assert.deepEqual(sfzSamples('<control> default_path=Samples/\n<region> sample="Grand Piano.wav" key=60\n// comment\n<region> sample=Grand Piano.wav key=61'),['Samples/Grand Piano.wav']);
 assert.throws(()=>sfzSamples('#include "other.sfz"'));
});
test('decoded stereo interleaves and clips samples',()=>{
 const b=pcmFromAudio({length:2,numberOfChannels:2,sampleRate:48000,getChannelData:c=>c?[0.5,-2]:[-1,2]});
 const v=new DataView(b.buffer);assert.deepEqual([44,46,48,50].map(p=>v.getInt16(p,true)),[-32768,16384,32767,-32768]);
});
test('ZIP exports files for independent verification',async()=>{
 const z=zip([{name:'เสียง.wav',data:extractSF2(fixture())[0].data}]);
 await writeFile('/tmp/wav-test.zip',new Uint8Array(await z.arrayBuffer()));
 assert.equal(new DataView(await z.arrayBuffer()).getUint32(0,true),0x04034b50);
});
