class PCMCapture extends AudioWorkletProcessor {
  constructor() {
    super();this.capture=null;
    this.port.onmessage=({data})=>{
      if(data.type==='stop')this.capture=null;
      if(data.type==='record')this.capture={id:data.id,remaining:data.frames,armed:false};
    };
  }
  process(inputs,outputs) {
    for(const out of outputs)for(const channel of out)channel.fill(0);
    const input=inputs[0],c=this.capture;
    if(!c || !input?.length || !input[0].length)return true;
    if(!c.armed){c.armed=true;this.port.postMessage({type:'armed',id:c.id});}
    const n=Math.min(input[0].length,c.remaining);
    const channels=input.map(channel=>channel.slice(0,n));
    this.port.postMessage({type:'data',id:c.id,channels},channels.map(a=>a.buffer));
    c.remaining-=n;
    if(c.remaining<=0){this.port.postMessage({type:'done',id:c.id});this.capture=null;}
    return true;
  }
}
registerProcessor('pcm-capture',PCMCapture);
