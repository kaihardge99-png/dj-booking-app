const fs = require('fs');
const filePath = process.argv[2] || 'tmp/ics_output.json';
function pad(n){return String(n).padStart(2,'0');}
const OPERATING_HOURS={0:null,1:{open:10,close:17},2:{open:10,close:17},3:{open:10,close:17},4:{open:10,close:22},5:{open:10,close:22},6:{open:10,close:17}};
try{
  const raw = fs.readFileSync(filePath,'utf8');
  const data = JSON.parse(raw);
  const slotsByDate = data.slotsByDate || data;
  const partials = [];
  for(const [date, info] of Object.entries(slotsByDate)){
    const dow = new Date(date + 'T00:00:00').getDay();
    const hours = OPERATING_HOURS[dow];
    const maxSlots = hours? (hours.close - hours.open) : 0;
    const available = info.slots || [];
    if(maxSlots>0 && available.length>0 && available.length<maxSlots){
      // compute missing slots
      const all = [];
      for(let h=hours.open; h<hours.close; h++) all.push(pad(h)+':00');
      const missing = all.filter(s=>!available.includes(s));
      partials.push({date, availableSlots: available.length, maxSlots, available, missing});
    }
  }
  if(partials.length===0){
    console.log('No partially-available dates found.');
    process.exit(0);
  }
  console.log(JSON.stringify({partialDates:partials},null,2));
}catch(err){ console.error('Error:', err.message); process.exit(1); }