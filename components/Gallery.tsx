"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";

import { galleryImages } from "@/lib/site";

export function Gallery() {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const close = useCallback(() => setActiveIndex(null), []);

  const showPrev = useCallback(() => {
    setActiveIndex((index) =>
      index === null ? null : (index + galleryImages.length - 1) % galleryImages.length
    );
  }, []);

  const showNext = useCallback(() => {
    setActiveIndex((index) => (index === null ? null : (index + 1) % galleryImages.length));
  }, []);

  useEffect(() => {
    if (activeIndex === null) return;

    const scrollY = window.scrollY;
    const body = document.body;
    const previousStyles = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow
    };

    body.classList.add("modal-lock");
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowLeft") showPrev();
      if (event.key === "ArrowRight") showNext();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      body.classList.remove("modal-lock");
      Object.assign(body.style, previousStyles);
      window.scrollTo(0, scrollY);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeIndex, close, showPrev, showNext]);

  const activeImage = activeIndex === null ? null : galleryImages[activeIndex];

  return (
    <>
      <div className="container gallery-grid">
        {galleryImages.map((image, index) => (
          <button
            aria-label={`Открыть фото: ${image.alt}`}
            className="gallery-item"
            key={image.src}
            type="button"
            onClick={() => setActiveIndex(index)}
          >
            <Image alt={image.alt} fill sizes="(max-width: 900px) 50vw, 25vw" src={image.src} />
          </button>
        ))}
      </div>
      {activeImage ? (
        <div className="modal-backdrop lightbox-backdrop" onMouseDown={close}>
          <div className="lightbox" onMouseDown={(event) => event.stopPropagation()}>
            <button
              aria-label="Закрыть"
              className="modal-close lightbox-close"
              onClick={close}
              type="button"
            >
              <span aria-hidden="true" />
            </button>
            <button
              aria-label="Предыдущее фото"
              className="lightbox-nav lightbox-nav--prev"
              onClick={showPrev}
              type="button"
            >
              ‹
            </button>
            <div className="lightbox-frame">
              <Image alt={activeImage.alt} fill sizes="90vw" src={activeImage.src} />
            </div>
            <button
              aria-label="Следующее фото"
              className="lightbox-nav lightbox-nav--next"
              onClick={showNext}
              type="button"
            >
              ›
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
