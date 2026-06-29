(function () {
  const links = Array.from(document.querySelectorAll('.toc a[href^="#"]'));
  const sections = links
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  function setActive() {
    const current = sections
      .filter((section) => section.getBoundingClientRect().top <= 120)
      .pop();
    links.forEach((link) => {
      link.classList.toggle('active', current && link.getAttribute('href') === `#${current.id}`);
    });
  }

  document.addEventListener('scroll', setActive, { passive: true });
  setActive();

  const filterButtons = Array.from(document.querySelectorAll('[data-filter]'));
  const filterTargets = Array.from(document.querySelectorAll('[data-role]'));
  let activeFilter = 'all';

  function syncTocForFilter(filter) {
    links.forEach((link) => {
      const section = document.querySelector(link.getAttribute('href'));
      const roles = section?.getAttribute('data-role')?.split(' ') ?? [];
      const hidden = filter !== 'all' && roles.length > 0 && !roles.includes(filter);
      link.classList.toggle('hidden-by-filter', hidden);
      link.setAttribute('aria-hidden', hidden ? 'true' : 'false');
      link.tabIndex = hidden ? -1 : 0;
    });
  }

  filterButtons.forEach((button) => {
    button.setAttribute('aria-pressed', button.classList.contains('active') ? 'true' : 'false');
    button.addEventListener('click', () => {
      const filter = button.getAttribute('data-filter');
      activeFilter = filter;
      filterButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      filterTargets.forEach((target) => {
        const roles = target.getAttribute('data-role').split(' ');
        target.classList.toggle('hidden-by-filter', filter !== 'all' && !roles.includes(filter));
      });
      syncTocForFilter(filter);
    });
  });
  syncTocForFilter(activeFilter);

  links.forEach((link) => {
    link.addEventListener('click', () => {
      if (link.classList.contains('hidden-by-filter')) {
        const allButton = filterButtons.find((button) => button.getAttribute('data-filter') === 'all');
        allButton?.click();
      }
    });
  });

  const lightbox = document.createElement('div');
  lightbox.className = 'lightbox';
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-modal', 'true');
  lightbox.setAttribute('aria-label', 'Xem ảnh phóng to');
  lightbox.innerHTML = '<button class="lightbox-close" type="button" aria-label="Đóng ảnh">Đóng</button><img alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">';
  document.body.appendChild(lightbox);

  const lightboxImage = lightbox.querySelector('img');
  const closeButton = lightbox.querySelector('button');
  let lastTrigger = null;
  const close = () => {
    lightbox.classList.remove('open');
    lastTrigger?.focus();
    lastTrigger = null;
  };
  closeButton.addEventListener('click', close);
  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) close();
  });
  document.addEventListener('keydown', (event) => {
    if (!lightbox.classList.contains('open')) return;
    if (event.key === 'Escape') close();
    if (event.key === 'Tab') {
      event.preventDefault();
      closeButton.focus();
    }
  });

  document.querySelectorAll('.figure img').forEach((image) => {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'figure-zoom';
    trigger.setAttribute('aria-label', `Phóng to ảnh: ${image.alt || 'ảnh minh họa'}`);
    image.parentNode.insertBefore(trigger, image);
    trigger.appendChild(image);
    trigger.addEventListener('click', () => {
      lastTrigger = trigger;
      lightboxImage.src = image.src;
      lightboxImage.alt = image.alt;
      lightbox.classList.add('open');
      closeButton.focus();
    });
  });
})();
