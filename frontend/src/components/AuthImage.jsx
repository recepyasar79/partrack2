import { useEffect, useState } from 'react';
import { api } from '../services/api';

export default function AuthImage({ src, alt = '', className = '', onClick, ...rest }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!src) return;
    let revoke;
    let cancelled = false;
    setError(false);
    setBlobUrl(null);

    api
      .get(src, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        const url = URL.createObjectURL(res.data);
        revoke = url;
        setBlobUrl(url);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [src]);

  if (error) {
    return (
      <div className={`bg-slate-100 flex items-center justify-center text-xs text-slate-400 ${className}`} {...rest}>
        ✕
      </div>
    );
  }

  if (!blobUrl) {
    return <div className={`bg-slate-100 animate-pulse ${className}`} {...rest} />;
  }

  return <img src={blobUrl} alt={alt} className={className} onClick={onClick} {...rest} />;
}
