const fs = require('fs');

// 1. Update IPTVPlayer.tsx
let iptv = fs.readFileSync('application/src/components/IPTVPlayer.tsx', 'utf8');
iptv = iptv.replace('gap-6 h-[calc(100dvh-200px)]', 'gap-6 lg:h-[calc(100dvh-200px)]');
iptv = iptv.replace('<VideoPlayer \n                    {...(currentChannel ? { channel: currentChannel } : {})}\n                    className="h-full"', '<VideoPlayer \n                    {...(currentChannel ? { channel: currentChannel } : {})}\n                    className="w-full lg:h-full"');
if (!iptv.includes('className="w-full lg:h-full"')) {
  iptv = iptv.replace('className="h-full"', 'className="w-full lg:h-full"');
}
fs.writeFileSync('application/src/components/IPTVPlayer.tsx', iptv, 'utf8');
console.log('IPTVPlayer updated.');
