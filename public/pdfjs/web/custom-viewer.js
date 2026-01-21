/**
 * Custom PDF.js viewer script
 * Đặt file này trong thư mục: /pdfjs/web/custom-viewer.js
 * Và thêm vào viewer.html: <script src="custom-viewer.js"></script>
 */

// Touch/Trackpad zoom support for better UX
let isPinching = false;
let lastDistance = 0;

function getDistance(touch1, touch2) {
  const dx = touch1.clientX - touch2.clientX;
  const dy = touch1.clientY - touch2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function setupZoomControls(container) {
  console.log('Setting up zoom controls');
  
  // Touchpad pinch zoom (using wheel event with ctrlKey) - Chrome/Edge behavior
  container.addEventListener('wheel', function(evt) {
    if (!evt.ctrlKey) return;
    evt.preventDefault();
    evt.stopPropagation();

    console.log('🔍 [WHEEL ZOOM] Starting...');
    const scaleDelta = evt.deltaY > 0 ? 0.95 : 1.05;
    const viewer = window.PDFViewerApplication.pdfViewer;
    const queue = window.PDFViewerApplication.pdfRenderingQueue;
    const currentScale = viewer.currentScale;
    const newScale = currentScale * scaleDelta;
    const clampedScale = Math.max(0.25, Math.min(5, newScale));

    // Save current page to prevent jumping to page 1
    const currentPage = window.PDFViewerApplication.page;
    console.log('🔍 [WHEEL ZOOM] Current page:', currentPage, 'Scale:', currentScale, '→', clampedScale);
    
    // Keep viewport center stable (no page jump) without anchoring to cursor
    const rect = container.getBoundingClientRect();
    const centerX = container.scrollLeft + rect.width / 2;
    const centerY = container.scrollTop + rect.height / 2;
    const scaleFactor = clampedScale / currentScale;
    
    console.log('🔍 [WHEEL ZOOM] Scroll before:', {
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
      centerX,
      centerY,
      scaleFactor
    });

    // Use pdf.js API to update scale without scroll jump
    if (viewer && typeof viewer._setScale === 'function') {
      viewer._setScale(clampedScale, { noScroll: true });
    } else {
      viewer.currentScale = clampedScale;
    }

    requestAnimationFrame(() => {
      const pageAfter = window.PDFViewerApplication.page;
      console.log('🔍 [WHEEL ZOOM] Page after scale change:', pageAfter);
      
      // Restore page number to prevent jump to page 1
      if (window.PDFViewerApplication.page !== currentPage) {
        console.log('⚠️ [WHEEL ZOOM] Page changed! Restoring from', pageAfter, 'to', currentPage);
        window.PDFViewerApplication.page = currentPage;
      }
      
      const newScrollLeft = centerX * scaleFactor - rect.width / 2;
      const newScrollTop = centerY * scaleFactor - rect.height / 2;
      container.scrollLeft = Math.max(0, newScrollLeft);
      container.scrollTop = Math.max(0, newScrollTop);
      
      console.log('🔍 [WHEEL ZOOM] Scroll after:', {
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
        finalPage: window.PDFViewerApplication.page
      });
      
      // Force complete re-render with multiple passes
      try {
        // Method 1: Force rendering immediately
        window.PDFViewerApplication.forceRendering();
        queue?.renderHighestPriority?.();
        
        // Method 2: Update all visible pages
        if (viewer && viewer._pages) {
          viewer._pages.forEach((pageView) => {
            if (pageView.div && pageView.div.offsetParent) {
              pageView.reset();
              pageView.update(clampedScale);
            }
          });
        }
        
        // Method 3: Trigger another render pass after a delay
        setTimeout(() => {
          try {
            window.PDFViewerApplication.forceRendering();
            queue?.renderHighestPriority?.();
          } catch (e2) {
            console.warn('forceRendering delayed error', e2);
          }
        }, 50);
      } catch (e) {
        console.warn('forceRendering wheel error', e);
      }
      console.log('✅ [WHEEL ZOOM] Complete\n');
    });
  }, { passive: false });

  // Touch pinch zoom for touch devices
  container.addEventListener('touchstart', function(evt) {
    if (evt.touches.length === 2) {
      isPinching = true;
      lastDistance = getDistance(evt.touches[0], evt.touches[1]);
      evt.preventDefault();
    }
  }, { passive: false });

  container.addEventListener('touchmove', function(evt) {
    if (isPinching && evt.touches.length === 2) {
      evt.preventDefault();
      
      const currentDistance = getDistance(evt.touches[0], evt.touches[1]);
      const delta = currentDistance - lastDistance;
      
      if (Math.abs(delta) > 5) {
        console.log('👆 [PINCH ZOOM] Starting...');
        const scaleDelta = delta > 0 ? 1.02 : 0.98;
        const viewer = window.PDFViewerApplication.pdfViewer;
        const queue = window.PDFViewerApplication.pdfRenderingQueue;
        const currentScale = viewer.currentScale;
        const newScale = currentScale * scaleDelta;
        
        const clampedScale = Math.max(0.25, Math.min(5, newScale));
        const scaleFactor = clampedScale / currentScale;
        
        // Save current page to prevent jumping to page 1
        const currentPage = window.PDFViewerApplication.page;
        console.log('👆 [PINCH ZOOM] Current page:', currentPage, 'Scale:', currentScale, '→', clampedScale);
        
        // Keep viewport center stable (no page jump) for touch pinch
        const rect = container.getBoundingClientRect();
        const centerX = container.scrollLeft + rect.width / 2;
        const centerY = container.scrollTop + rect.height / 2;
        
        console.log('👆 [PINCH ZOOM] Scroll before:', {
          scrollLeft: container.scrollLeft,
          scrollTop: container.scrollTop,
          centerX,
          centerY,
          scaleFactor
        });

        if (viewer && typeof viewer._setScale === 'function') {
          viewer._setScale(clampedScale, { noScroll: true });
        } else {
          viewer.currentScale = clampedScale;
        }

        requestAnimationFrame(() => {
          const pageAfter = window.PDFViewerApplication.page;
          console.log('👆 [PINCH ZOOM] Page after scale change:', pageAfter);
          
          // Restore page number to prevent jump to page 1
          if (window.PDFViewerApplication.page !== currentPage) {
            console.log('⚠️ [PINCH ZOOM] Page changed! Restoring from', pageAfter, 'to', currentPage);
            window.PDFViewerApplication.page = currentPage;
          }
          
          const newScrollLeft = centerX * scaleFactor - rect.width / 2;
          const newScrollTop = centerY * scaleFactor - rect.height / 2;
          container.scrollLeft = Math.max(0, newScrollLeft);
          container.scrollTop = Math.max(0, newScrollTop);
          
          console.log('👆 [PINCH ZOOM] Scroll after:', {
            scrollLeft: container.scrollLeft,
            scrollTop: container.scrollTop,
            finalPage: window.PDFViewerApplication.page
          });
          
          // Force complete re-render with multiple passes
          try {
            // Method 1: Force rendering immediately
            window.PDFViewerApplication.forceRendering();
            queue?.renderHighestPriority?.();
            
            // Method 2: Update all visible pages
            if (viewer && viewer._pages) {
              viewer._pages.forEach((pageView) => {
                if (pageView.div && pageView.div.offsetParent) {
                  pageView.reset();
                  pageView.update(clampedScale);
                }
              });
            }
            
            // Method 3: Trigger another render pass after a delay
            setTimeout(() => {
              try {
                window.PDFViewerApplication.forceRendering();
                queue?.renderHighestPriority?.();
              } catch (e2) {
                console.warn('forceRendering delayed error', e2);
              }
            }, 50);
          } catch (e) {
            console.warn('forceRendering pinch error', e);
          }
          console.log('✅ [PINCH ZOOM] Complete\n');
        });
        
        lastDistance = currentDistance;
      }
    }
  }, { passive: false });

  container.addEventListener('touchend', function(evt) {
    if (evt.touches.length < 2) {
      isPinching = false;
    }
  });
}

// Đợi PDF.js load xong
document.addEventListener('DOMContentLoaded', function() {
  console.log('Custom PDF viewer script loaded');
  
  // Đợi viewer container sẵn sàng
  const waitForViewer = setInterval(function() {
    const container = document.getElementById('viewerContainer');
    if (container && window.PDFViewerApplication) {
      clearInterval(waitForViewer);
        initializeCustomFeatures(container);
        setupZoomControls(container);
        // notify parent that viewer is ready
        try {
          window.parent.postMessage({ type: 'PDF_VIEWER_READY' }, '*');
        } catch (e) {}
    }
  }, 100);
});

function initializeCustomFeatures(container) {
  console.log('Initializing custom PDF features');
  
  // ===== XỬ LÝ TEXT SELECTION =====
  // Use a pending timer so dblclick can cancel the mouseup handler
  let selectionPendingTimer = null;

  // Handle double-click explicitly (mouse double-click to select word)
  container.addEventListener('dblclick', function(e) {
    // Cancel any pending mouseup handler
    if (selectionPendingTimer) {
      clearTimeout(selectionPendingTimer);
      selectionPendingTimer = null;
    }
    // Double-click: handle immediately (browser has already selected the word)
    setTimeout(function() {
      handleTextSelection();
    }, 10);
  });

  container.addEventListener('mouseup', function(e) {
    // Cancel any existing pending timer
    if (selectionPendingTimer) {
      clearTimeout(selectionPendingTimer);
    }
    // Delay mouseup handling to give dblclick a chance to fire and cancel this
    // Browser dblclick detection is typically within 300-500ms
    selectionPendingTimer = setTimeout(function() {
      selectionPendingTimer = null;
      handleTextSelection();
    }, 250);
  });
  
  // Cũng xử lý khi dùng keyboard để select
  container.addEventListener('keyup', function(e) {
    if (e.shiftKey || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || 
        e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      setTimeout(function() {
        handleTextSelection();
      }, 50);
    }
  });
  
  function handleTextSelection() {
    const selection = window.getSelection();
    
    // Kiểm tra có text được chọn không
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return;
    }
    
    const text = selection.toString().trim();
    if (!text || text.length === 0) {
      return;
    }
    
    try {
      const range = selection.getRangeAt(0);
      
      // Tìm page element chứa selection
      let element = range.startContainer;
      if (element.nodeType === Node.TEXT_NODE) {
        element = element.parentElement;
      }
      
      const pageElement = element.closest('.page');
      if (!pageElement) {
        console.warn('Could not find page element');
        return;
      }
      
      const pageNumber = parseInt(pageElement.getAttribute('data-page-number'));
      if (isNaN(pageNumber)) {
        console.warn('Invalid page number');
        return;
      }
      
      // Tính toán tọa độ các rects (theo phần trăm, bám theo textLayer để không bị lệch)
      const textLayer = pageElement.querySelector('.textLayer');
      const baseRect = (textLayer || pageElement).getBoundingClientRect();
      const rects = [];
      const rangeRects = range.getClientRects();
      
      for (let i = 0; i < rangeRects.length; i++) {
        const rect = rangeRects[i];
        
        // Bỏ qua các rect có kích thước quá nhỏ
        if (rect.width < 1 || rect.height < 1) continue;
        
        rects.push({
          xPct: (rect.left - baseRect.left) / baseRect.width,
          yPct: (rect.top - baseRect.top) / baseRect.height,
          wPct: rect.width / baseRect.width,
          hPct: rect.height / baseRect.height
        });
      }
      
      if (rects.length === 0) {
        console.warn('No valid rects found');
        return;
      }
      
      // Gửi message về React component
      window.parent.postMessage({
        type: 'PDF_SELECTION',
        text: text,
        pageNumber: pageNumber,
        rects: rects
      }, '*');
      
      console.log('Text selected:', text, 'on page', pageNumber);
      
      // Xóa selection sau khi gửi
      selection.removeAllRanges();
      
    } catch (error) {
      console.error('Error processing text selection:', error);
    }
  }
  
  // ===== XỬ LÝ MESSAGES TỪ REACT =====
  window.addEventListener('message', function(event) {
    const data = event.data;
    
    if (!data || !data.type) return;
    
    switch (data.type) {
      case 'PDF_GO_TO_PAGE':
        handleGoToPage(data.pageNumber);
        break;

      case 'PDF_SET_HIGHLIGHTS':
        handleSetHighlights(data.highlights || data);
        break;

      case 'PDF_OPEN_BYTES':
        handleOpenPdfBytes(data.bytes);
        break;
    }
  });
  
  function handleGoToPage(pageNumber) {
    if (!window.PDFViewerApplication) {
      console.error('PDFViewerApplication not available');
      return;
    }
    
    if (pageNumber < 1 || pageNumber > window.PDFViewerApplication.pagesCount) {
      console.warn('Invalid page number:', pageNumber);
      return;
    }
    
    window.PDFViewerApplication.page = pageNumber;
    console.log('Navigated to page:', pageNumber);
  }
  
  function handleSetHighlights(highlights) {
    console.log('Received highlights:', highlights);
    // Accept either an array or an object { highlights: [] }
    let arr = []
    if (Array.isArray(highlights)) arr = highlights
    else if (highlights && Array.isArray(highlights.highlights)) arr = highlights.highlights
    else return

    drawHighlights(arr)
  }
  
  function handleOpenPdfBytes(bytes) {
    if (!window.PDFViewerApplication) {
      console.error('PDFViewerApplication not available');
      return;
    }
    
    try {
      // Convert bytes array to Uint8Array if needed
      const uint8Array = new Uint8Array(bytes);
      
      // Open PDF using PDF.js API
      window.PDFViewerApplication.open(uint8Array);
      console.log('PDF opened successfully');
      
    } catch (error) {
      console.error('Error opening PDF:', error);
    }
  }

  // Listen to page rendered events to inform React so it can post highlights
  try {
    if (window.PDFViewerApplication && window.PDFViewerApplication.eventBus) {
      window.PDFViewerApplication.eventBus.on('pagerendered', function(evt) {
        try {
          window.parent.postMessage({ type: 'PDF_PAGE_RENDERED', pageNumber: evt.pageNumber }, '*');
        } catch (e) {}
      });
    }
  } catch (e) {
    console.warn('Could not attach pagerendered listener', e);
  }
}

// ===== HELPER: VẼ HIGHLIGHTS (Optional) =====
function drawHighlights(highlights) {
  // Remove old highlights and tooltip
  document.querySelectorAll('.custom-highlight').forEach((el) => el.remove())
  let tooltip = document.getElementById('__custom_highlight_tooltip')
  if (!tooltip) {
    tooltip = document.createElement('div')
    tooltip.id = '__custom_highlight_tooltip'
    tooltip.style.position = 'fixed'
    tooltip.style.zIndex = '9999'
    tooltip.style.background = 'rgba(0,0,0,0.8)'
    tooltip.style.color = 'white'
    tooltip.style.padding = '6px 8px'
    tooltip.style.borderRadius = '4px'
    tooltip.style.fontSize = '12px'
    tooltip.style.pointerEvents = 'none'
    tooltip.style.transition = 'opacity 0.08s'
    tooltip.style.opacity = '0'
    document.body.appendChild(tooltip)
  }

  highlights.forEach(function(highlight) {
    const pageElement = document.querySelector('.page[data-page-number="' + highlight.pageNumber + '"]');
    if (!pageElement) return;
    const textLayer = pageElement.querySelector('.textLayer');
    const targetLayer = textLayer || pageElement;

    highlight.rects.forEach(function(rect) {
      const highlightDiv = document.createElement('div');
      highlightDiv.className = 'custom-highlight';
      highlightDiv.style.position = 'absolute';
      highlightDiv.style.left = (rect.xPct * 100) + '%';
      highlightDiv.style.top = (rect.yPct * 100) + '%';
      highlightDiv.style.width = (rect.wPct * 100) + '%';
      highlightDiv.style.height = (rect.hPct * 100) + '%';
      highlightDiv.style.backgroundColor = 'rgba(255, 255, 0, 0.35)';
      highlightDiv.style.pointerEvents = 'auto';
      highlightDiv.style.zIndex = '5';
      highlightDiv.style.cursor = 'pointer';

      // store meta for tooltip
      const meaning = highlight.meaning || '';
      const word = (highlight.text || '').trim();
      highlightDiv.dataset.meaning = meaning;
      highlightDiv.dataset.word = word;

      highlightDiv.addEventListener('mouseenter', function(ev) {
        const t = document.getElementById('__custom_highlight_tooltip');
        if (!t) return;
        const content = meaning || word || '';
        if (!content) return;
        t.textContent = content;
        const r = (ev.currentTarget).getBoundingClientRect();
        // position above the rect if possible
        const top = Math.max(8, r.top - 30);
        const left = Math.max(8, r.left);
        t.style.left = left + 'px';
        t.style.top = top + 'px';
        t.style.opacity = '1';
      });

      highlightDiv.addEventListener('mouseleave', function() {
        const t = document.getElementById('__custom_highlight_tooltip');
        if (!t) return;
        t.style.opacity = '0';
      });

      targetLayer.appendChild(highlightDiv);
    });
  });
}