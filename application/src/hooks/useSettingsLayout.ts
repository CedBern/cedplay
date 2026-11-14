import { useEffect, useState } from 'react';

function viewport() {
  const visual = window.visualViewport;
  return {
    narrow: window.innerWidth <= 767,
    height: visual?.height ?? window.innerHeight,
    top: visual?.offsetTop ?? 0,
  };
}

export function useSettingsLayout(open: boolean, tvMode: boolean) {
  const [size, setSize] = useState(viewport);
  useEffect(() => {
    if (!open) return;
    const update = () => setSize(viewport());
    update();
    const visual = window.visualViewport;
    window.addEventListener('resize', update);
    visual?.addEventListener('resize', update);
    visual?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      visual?.removeEventListener('resize', update);
      visual?.removeEventListener('scroll', update);
    };
  }, [open]);
  return { mobile: size.narrow && !tvMode, height: size.height, top: size.top };
}
