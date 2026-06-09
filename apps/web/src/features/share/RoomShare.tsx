import { useEffect, useState } from 'react';

import QRCode from 'qrcode';

export function RoomShare({ roomId }: { roomId: string }) {
  const [qr, setQr] = useState('');
  const link = `${location.origin}/r/${encodeURIComponent(roomId)}`;
  useEffect(() => {
    void QRCode.toDataURL(link).then(setQr);
  }, [link]);
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-sm text-gray-600">把链接、二维码或口令发给对方：</p>
      {qr && <img src={qr} alt="二维码" className="size-40" />}
      <code
        className="rounded bg-gray-100 px-3 py-1 text-lg font-semibold"
        data-testid="room-code"
      >
        {roomId}
      </code>
      <a className="break-all text-sm text-blue-600 underline" href={link}>
        {link}
      </a>
    </div>
  );
}
