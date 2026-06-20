import React, { useEffect, useState, RefObject } from 'react';

interface MobileScrollIndicatorProps {
  targetRef: RefObject<HTMLElement | null>;
}

export function MobileScrollIndicator({ targetRef }: MobileScrollIndicatorProps) {
  const [scrollProgress, setScrollProgress] = useState(0);
  const [thumbHeight, setThumbHeight] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [containerBounds, setContainerBounds] = useState({ top: 0, height: 0 });

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!isMobile || !targetRef.current) return;

    const target = targetRef.current;
    let hideTimeout: NodeJS.Timeout;

    const handleScroll = () => {
      if (!target) return;
      
      const { scrollTop, scrollHeight, clientHeight } = target;
      
      // Update bounds
      const rect = target.getBoundingClientRect();
      setContainerBounds({ top: rect.top, height: rect.height });
      
      // If content is smaller than container, hide indicator
      if (scrollHeight <= clientHeight) {
        setIsVisible(false);
        return;
      }

      // Calculate thumb height proportionally
      const heightRatio = clientHeight / scrollHeight;
      const calculatedThumbHeight = Math.max(heightRatio * clientHeight, 30); // Min height 30px
      setThumbHeight(calculatedThumbHeight);

      // Calculate progress (0 to 1)
      const maxScrollTop = scrollHeight - clientHeight;
      const progress = scrollTop / maxScrollTop;
      setScrollProgress(progress);

      setIsVisible(true);

      // Hide after scrolling stops
      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(() => {
        setIsVisible(false);
      }, 1500);
    };

    // Initial calculation
    handleScroll();

    target.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);

    return () => {
      target.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
      clearTimeout(hideTimeout);
    };
  }, [isMobile, targetRef]);

  if (!isMobile || !isVisible) return null;

  // Calculate the top position of the thumb
  const maxThumbTop = containerBounds.height - thumbHeight;
  const thumbTop = scrollProgress * maxThumbTop;

  return (
    <div 
      className={`fixed w-1.5 z-50 pointer-events-none transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
      style={{
        top: `${containerBounds.top}px`,
        height: `${containerBounds.height}px`,
        left: '4px', // Left side for RTL
      }}
    >
      <div 
        className="absolute w-full bg-[var(--primary)] rounded-full opacity-60"
        style={{
          height: `${thumbHeight}px`,
          transform: `translateY(${thumbTop}px)`,
          willChange: 'transform',
        }}
      />
    </div>
  );
}
