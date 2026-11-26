import { useCallback, useEffect, useRef, useState } from 'react';
import { gsap, isReducedMotion } from '../motion/gsap';
import { useAppStore } from '../store/useAppStore';

/**
 * 登录后的片头：播放翻开账本的视频，结束或跳过后进入书页主界面。
 * 视频不可用时退回书封开启的 CSS 动画，确保不阻塞进入。
 */
export function LedgerIntro() {
  const finishIntro = useAppStore((s) => s.finishIntro);
  const rootRef = useRef<HTMLDivElement>(null);
  const closedRef = useRef(false);
  const [videoStarted, setVideoStarted] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  const dismiss = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    const root = rootRef.current;
    if (!root || isReducedMotion()) {
      finishIntro();
      return;
    }
    gsap.to(root, { opacity: 0, duration: 0.55, ease: 'power2.out', onComplete: finishIntro });
  }, [finishIntro]);

  useEffect(() => {
    if (isReducedMotion()) dismiss();
  }, [dismiss]);

  useEffect(() => {
    const failsafe = window.setTimeout(dismiss, 9000);
    return () => window.clearTimeout(failsafe);
  }, [dismiss]);

  useEffect(() => {
    if (videoFailed) {
      const timer = window.setTimeout(dismiss, 2600);
      return () => window.clearTimeout(timer);
    }
    if (videoStarted) return;
    const timer = window.setTimeout(() => setVideoFailed(true), 2800);
    return () => window.clearTimeout(timer);
  }, [dismiss, videoFailed, videoStarted]);

  return (
    <div className="ledger-intro" ref={rootRef} data-testid="ledger-intro">
      <div className="intro-halo" aria-hidden="true" />
      <div className="intro-stage">
        <p className="intro-brand">
          <span className="intro-brand-mark">¥</span>
          金钱流水
          <em>LOCAL LEDGER</em>
        </p>

        <div className="intro-frame">
          {!videoFailed ? (
            <video
              className={`intro-video${videoStarted ? ' is-playing' : ''}`}
              src="/media/ledger-intro.mp4"
              autoPlay
              muted
              playsInline
              preload="auto"
              onPlaying={() => setVideoStarted(true)}
              onEnded={dismiss}
              onError={() => setVideoFailed(true)}
            />
          ) : (
            <div className="intro-book" aria-hidden="true">
              <span className="intro-book-pages">
                <i />
                <i />
                <i />
              </span>
              <span className="intro-book-cover">
                <b>¥</b>
                <small>金钱流水</small>
              </span>
            </div>
          )}
          {!videoStarted && !videoFailed && (
            <div className="intro-loading" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>

        <p className="intro-caption">正在翻开你的本地账本 · 所有数据只在这台设备</p>
      </div>
      <button type="button" className="intro-skip" onClick={dismiss} data-testid="intro-skip">
        跳过片头
      </button>
    </div>
  );
}