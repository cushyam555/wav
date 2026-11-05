const enc=new TextEncoder();
function crc(data){let n=0xffffffff;for(const b of data){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;}
export function zip(files){
  const local=[],central=[];let offset=0,total=0;
  if(files.length>65535)throw Error('จำนวนไฟล์มากเกิน ZIP แบบมาตรฐาน');
  for(const f of files){
    const name=enc.encode(f.name), data=f.data, sum=crc(data);
    if(name.length>65535 || offset+data.length+name.length+30>0xffffffff)throw Error('ZIP มีขนาดใหญ่เกิน 4 GB');
    const header=new Uint8Array(30+name.length),h=new DataView(header.buffer);
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint32(14,sum,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);header.set(name,30);
    const dir=new Uint8Array(46+name.length),d=new DataView(dir.buffer);
    d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint32(16,sum,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);dir.set(name,46);
    local.push(header,data);central.push(dir);offset+=header.length+data.length;total+=dir.length;
  }
  const tail=new Uint8Array(22),v=new DataView(tail.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,total,true);v.setUint32(16,offset,true);
  return new Blob([...local,...central,tail],{type:'application/zip'});
}
