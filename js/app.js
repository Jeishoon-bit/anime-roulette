(() => {
  const ANILIST_URL = 'https://graphql.anilist.co';
  const STORAGE_KEY = 'anime_roulette_watched_v2';
  const POZO_STORAGE_KEY = 'anime_roulette_pozo';
  const DURACION_GIRO_NORMAL_MS = 5000;
  const DURACION_GIRO_REDUCIDO_MS = 800;
  const VUELTAS_NORMALES_DEG = 2160; // 6 vueltas completas
  const VUELTAS_REDUCIDAS_DEG = 360; // 1 vuelta completa
  const REQUEST_TIMEOUT_MS = 10000;
  const ANILIST_PER_PAGE = 40;
  const POZO_MIN_MEMBERS = 500;
  const POZO_MAX_MEMBERS = 10000;
  const TONOS_SAKURA = ['#F48FB1', '#F06292', '#F8BBD0', '#EC4899'];

  const WHEEL_SEGMENTS = [
    { label: 'Acción', color: '#E12D53', genre: 'Action' },
    { label: 'Aventura', color: '#B45309', genre: 'Adventure' },
    { label: 'Comedia', color: '#15803D', genre: 'Comedy' },
    { label: 'Fantasía', color: '#6D28D9', genre: 'Fantasy' },
    { label: 'Misterio', color: '#0369A1', genre: 'Mystery' },
    { label: 'Slice of Life', color: '#BE185D', genre: 'Slice of Life' },
    { label: 'Sci-Fi', color: '#3730A3', genre: 'Sci-Fi' },
    { label: 'Romance', color: '#9D174D', genre: 'Romance' },
    { label: 'Sorpresa', color: '#C2410C', genre: '' },
  ];

  const EXPLICIT_GENRES = new Set(['hentai', 'ecchi', 'erotica']);

  const poolCache = new Map();

  const state = {
    currentPage: getPageFromHash(),
    genre: '',
    minScore: '7.5',
    modoPozo: loadModoPozo(),
    rotation: 0,
    animationFrameId: null,
    revealTimers: [],
    activePetals: [],
    isSpinning: false,
    currentAnime: null,
    lastShownId: null,
    expandedSynopsis: false,
    confirmReset: false,
    watchedList: loadWatched(),
  };

  // DOM References
  const rouletteSvg = document.getElementById('roulette-svg');
  const pointerNeedle = document.getElementById('wheel-pointer-needle');
  const genreButtonsContainer = document.getElementById('genre-buttons');
  const minScoreSelect = document.getElementById('min-score-select');
  const pozoToggleBtn = document.getElementById('pozo-toggle-btn');
  const activeRulesSummary = document.getElementById('active-rules-summary');
  const gotoFiltersBtn = document.getElementById('goto-filters-btn');
  const resetFiltersPageBtn = document.getElementById('reset-filters-page-btn');
  const spinFromFiltersBtn = document.getElementById('spin-from-filters-btn');
  const headerSpinBtn = document.getElementById('header-spin-btn');
  const mainSpinBtn = document.getElementById('main-spin-btn');
  const wheelHubBtn = document.getElementById('wheel-hub-btn');
  const wheelHubText = document.getElementById('wheel-hub-text');
  const emptySpinBtn = document.getElementById('empty-spin-btn');
  const retrySpinBtn = document.getElementById('retry-spin-btn');
  const clearFiltersBtn = document.getElementById('clear-filters-btn');
  const nextSpinBtn = document.getElementById('next-spin-btn');

  const stateIdle = document.getElementById('state-idle');
  const stateLoading = document.getElementById('state-loading');
  const stateError = document.getElementById('state-error');
  const animeCard = document.getElementById('anime-card');
  const loadingDetail = document.getElementById('loading-detail');
  const errorMessage = document.getElementById('error-message');

  const animePoster = document.getElementById('anime-poster');
  const posterFallback = document.getElementById('poster-fallback');
  const posterFallbackTitle = document.getElementById('poster-fallback-title');
  const animeScore = document.getElementById('anime-score');
  const pozoPopularityNote = document.getElementById('pozo-popularity-note');
  const animeEpisodes = document.getElementById('anime-episodes');
  const animeStatus = document.getElementById('anime-status');
  const animeYearSep = document.getElementById('anime-year-sep');
  const animeYear = document.getElementById('anime-year');
  const animeTitle = document.getElementById('anime-title');
  const animeSubtitles = document.getElementById('anime-subtitles');
  const animeGenres = document.getElementById('anime-genres');
  const animeSynopsis = document.getElementById('anime-synopsis');
  const toggleSynopsisBtn = document.getElementById('toggle-synopsis-btn');
  const markWatchedBtn = document.getElementById('mark-watched-btn');
  const shareCardBtn = document.getElementById('share-card-btn');
  const malLink = document.getElementById('mal-link');

  const navWatchedCount = document.getElementById('nav-watched-count');
  const mobileWatchedCount = document.getElementById('mobile-watched-count');
  const excludedCount = document.getElementById('excluded-count');
  const historySummary = document.getElementById('history-summary');
  const historyEmptyBox = document.getElementById('history-empty-box');
  const resetControls = document.getElementById('reset-controls');
  const cancelResetBtn = document.getElementById('cancel-reset-btn');
  const resetHistoryBtn = document.getElementById('reset-history-btn');
  const watchedGrid = document.getElementById('watched-grid');

  function getPageFromHash() {
    const raw = window.location.hash.replace(/^#/, '').toLowerCase();
    if (raw === 'filtros' || raw === 'historial' || raw === 'bitacora') {
      return raw;
    }
    return 'ruleta';
  }

  function renderPageVisibility(page) {
    state.currentPage = page;
    ['ruleta', 'filtros', 'historial', 'bitacora'].forEach((id) => {
      const section = document.getElementById(`page-${id}`);
      if (section) {
        section.classList.toggle('is-hidden', id !== page);
      }
    });

    document.querySelectorAll('[data-page-link]').forEach((el) => {
      if (el.classList.contains('mobile-tab') || el.closest('.nav-links')) {
        const active = el.dataset.pageLink === page;
        el.classList.toggle('is-active', active);
        if (active) el.setAttribute('aria-current', 'page');
        else el.removeAttribute('aria-current');
      }
    });
  }

  function navigateTo(page) {
    renderPageVisibility(page);
    if (window.location.hash !== `#${page}`) {
      window.history.pushState(null, '', `#${page}`);
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function updateActiveRulesSummary() {
    if (!activeRulesSummary) return;
    const activeBtn = genreButtonsContainer.querySelector('.genre-btn.is-active');
    const genreLabel = activeBtn && activeBtn.textContent !== 'Todos' ? activeBtn.textContent : 'Todos los géneros';
    const selectedOpt = minScoreSelect.options[minScoreSelect.selectedIndex];
    const scoreLabel = selectedOpt ? selectedOpt.textContent : 'Cualquier puntuación';
    const partes = [genreLabel, scoreLabel];
    if (state.modoPozo) partes.push('Pozo Olvidado');
    partes.push(`${state.watchedList.length} excluidos`);
    activeRulesSummary.textContent = partes.join(' · ');
  }

  function loadModoPozo() {
    try {
      return localStorage.getItem(POZO_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  function saveModoPozo() {
    try {
      localStorage.setItem(POZO_STORAGE_KEY, String(state.modoPozo));
    } catch {
      // Ignorar errores de almacenamiento
    }
  }

  function updatePozoUI() {
    if (!pozoToggleBtn) return;
    pozoToggleBtn.classList.toggle('is-active', state.modoPozo);
    pozoToggleBtn.setAttribute('aria-checked', String(state.modoPozo));
  }

  function formatearMiles(valor) {
    return String(Math.round(valor)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function loadWatched() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveWatched() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.watchedList));
    } catch {
      // Ignorar errores de cuota de almacenamiento
    }
  }

  function getWatchedIdsSet() {
    return new Set(state.watchedList.map((item) => item.id));
  }

  function cleanHtmlSynopsis(raw) {
    if (!raw) {
      return 'No hay sinopsis disponible para este título.';
    }
    return raw
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function polarToCartesian(cx, cy, r, angleDeg) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  }

  function describeArcWedge(cx, cy, outerR, innerR, startAngle, endAngle) {
    const startOuter = polarToCartesian(cx, cy, outerR, endAngle);
    const endOuter = polarToCartesian(cx, cy, outerR, startAngle);
    const startInner = polarToCartesian(cx, cy, innerR, endAngle);
    const endInner = polarToCartesian(cx, cy, innerR, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

    return [
      'M', startOuter.x, startOuter.y,
      'A', outerR, outerR, 0, largeArcFlag, 0, endOuter.x, endOuter.y,
      'L', endInner.x, endInner.y,
      'A', innerR, innerR, 0, largeArcFlag, 1, startInner.x, startInner.y,
      'Z',
    ].join(' ');
  }

  function renderWheel() {
    const segmentAngle = 360 / WHEEL_SEGMENTS.length;
    const parts = [
      '<circle cx="160" cy="160" r="150" fill="#FFFDF8" stroke="#1C1B18" stroke-width="3" />',
    ];

    WHEEL_SEGMENTS.forEach((seg, index) => {
      const start = index * segmentAngle;
      const end = start + segmentAngle;
      const mid = start + segmentAngle / 2;
      const pos = polarToCartesian(160, 160, 101, mid);
      const isHighlighted = state.genre === '' || state.genre === seg.genre;
      const fillOpacity = isHighlighted ? '0.96' : '0.34';
      const labelColor = isHighlighted ? '#FFFFFF' : '#1C1B18';

      parts.push(
        `<path class="wheel-segment" data-segment-index="${index}" d="${describeArcWedge(160, 160, 146, 48, start, end)}" fill="${seg.color}" fill-opacity="${fillOpacity}" stroke="#1C1B18" stroke-width="2.2" />`
      );
      parts.push(
        `<path d="${describeArcWedge(160, 160, 146, 138, start, end)}" fill="${seg.color}" fill-opacity="0.96" stroke="#1C1B18" stroke-width="1.5" />`
      );
      parts.push(
        `<text x="${pos.x}" y="${pos.y}" fill="${labelColor}" font-size="11.2" font-weight="700" letter-spacing="0.02em" font-family="Bricolage Grotesque, sans-serif" text-anchor="middle" dominant-baseline="middle" transform="rotate(${mid + 90}, ${pos.x}, ${pos.y})">${seg.label}</text>`
      );
    });

    parts.push('<g id="winner-glow-layer" class="winner-glow-overlay" aria-hidden="true"></g>');
    parts.push('<circle cx="160" cy="160" r="50" fill="#FFFDF8" stroke="#1C1B18" stroke-width="2.5" />');
    rouletteSvg.innerHTML = parts.join('');
  }

  function translateStatus(status) {
    if (!status) return 'Desconocido';
    switch (status.toUpperCase()) {
      case 'FINISHED':
      case 'FINISHED AIRING':
        return 'Finalizado';
      case 'RELEASING':
      case 'CURRENT':
      case 'CURRENTLY AIRING':
        return 'En emisión';
      case 'NOT_YET_RELEASED':
      case 'UPCOMING':
      case 'TBA':
        return 'Próximamente';
      case 'CANCELLED':
        return 'Cancelado';
      case 'HIATUS':
        return 'En pausa';
      default:
        return status;
    }
  }

  function showStage(stageName) {
    stateIdle.classList.toggle('is-hidden', stageName !== 'idle');
    stateLoading.classList.toggle('is-hidden', stageName !== 'loading');
    stateError.classList.toggle('is-hidden', stageName !== 'error');
    animeCard.classList.toggle('is-hidden', stageName !== 'result');
  }

  function setSpinningUI(spinning) {
    state.isSpinning = spinning;
    [
      headerSpinBtn,
      mainSpinBtn,
      wheelHubBtn,
      emptySpinBtn,
      retrySpinBtn,
      nextSpinBtn,
      shareCardBtn,
      minScoreSelect,
      pozoToggleBtn,
      gotoFiltersBtn,
      spinFromFiltersBtn,
      resetFiltersPageBtn,
    ].forEach((el) => {
      if (el) el.disabled = spinning;
    });
    genreButtonsContainer.querySelectorAll('button').forEach((btn) => {
      btn.disabled = spinning;
    });
    mainSpinBtn.textContent = spinning ? 'Girando ruleta…' : 'Girar / Recomendar Anime';
    headerSpinBtn.textContent = spinning ? 'Girando…' : 'Girar ruleta';
    wheelHubText.textContent = spinning ? 'Girando' : 'Girar';
  }

  function esperar(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  const ANILIST_QUERY = `
    query (
      $page: Int,
      $perPage: Int,
      $genre: [String],
      $scoreGreater: Int,
      $popularityGreater: Int,
      $popularityLesser: Int
    ) {
      Page(page: $page, perPage: $perPage) {
        pageInfo {
          lastPage
          hasNextPage
        }
        media(
          type: ANIME
          isAdult: false
          genre_not_in: ["Hentai", "Ecchi"]
          genre_in: $genre
          averageScore_greater: $scoreGreater
          popularity_greater: $popularityGreater
          popularity_lesser: $popularityLesser
          sort: POPULARITY_DESC
        ) {
          id
          idMal
          siteUrl
          title {
            romaji
            english
            native
          }
          coverImage {
            extraLarge
            large
          }
          description(asHtml: false)
          averageScore
          popularity
          episodes
          status
          seasonYear
          genres
          isAdult
        }
      }
    }
  `;

  function isSafeForWorkMedia(media) {
    if (media.isAdult) return false;
    const genres = Array.isArray(media.genres) ? media.genres : [];
    return !genres.some((g) => EXPLICIT_GENRES.has(String(g || '').toLowerCase()));
  }

  function mapAniListAnime(media, modoPozo) {
    const malId = typeof media.idMal === 'number' ? media.idMal : null;
    const url = malId
      ? `https://myanimelist.net/anime/${malId}`
      : media.siteUrl || `https://anilist.co/anime/${media.id}`;
    const titleObj = media.title || {};
    const coverObj = media.coverImage || {};
    const score =
      typeof media.averageScore === 'number'
        ? Number((media.averageScore / 10).toFixed(2))
        : null;

    return {
      id: media.id,
      malId,
      url,
      title: titleObj.romaji || titleObj.english || 'Anime sin título',
      titleEnglish: titleObj.english || null,
      titleJapanese: titleObj.native || null,
      imageUrl: coverObj.extraLarge || coverObj.large || '',
      score,
      popularity: typeof media.popularity === 'number' ? media.popularity : null,
      fromPozo: Boolean(modoPozo),
      episodes: typeof media.episodes === 'number' ? media.episodes : null,
      status: media.status || null,
      year: typeof media.seasonYear === 'number' ? media.seasonYear : null,
      genres: Array.isArray(media.genres) ? media.genres.slice(0, 6) : [],
      synopsis: cleanHtmlSynopsis(media.description),
    };
  }

  async function fetchAniListPage(genre, minScore, page, modoPozo, reintento = 0) {
    const variables = {
      page,
      perPage: ANILIST_PER_PAGE,
    };

    if (genre) {
      variables.genre = [genre];
    }
    if (minScore) {
      const score100 = Math.round(Number(minScore) * 10);
      if (Number.isFinite(score100) && score100 > 0) {
        variables.scoreGreater = Math.max(0, score100 - 1);
      }
    }
    if (modoPozo) {
      variables.popularityGreater = POZO_MIN_MEMBERS;
      variables.popularityLesser = POZO_MAX_MEMBERS;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(ANILIST_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          query: ANILIST_QUERY,
          variables,
        }),
      });

      if (response.status === 429 && reintento < 2) {
        clearTimeout(timeoutId);
        await esperar(700 * (reintento + 1));
        return fetchAniListPage(genre, minScore, page, modoPozo, reintento + 1);
      }

      if (!response.ok) {
        throw new Error(`HTTP_${response.status}`);
      }

      const json = await response.json();
      if (Array.isArray(json.errors) && json.errors.length > 0 && !(json.data && json.data.Page)) {
        throw new Error((json.errors[0] && json.errors[0].message) || 'Error en AniList.');
      }

      const pageData = (json.data && json.data.Page) || {};
      const rawList = Array.isArray(pageData.media) ? pageData.media : [];
      const items = rawList
        .filter(isSafeForWorkMedia)
        .map((media) => mapAniListAnime(media, modoPozo));

      const pageInfo = pageData.pageInfo || {};
      const lastPage = Math.max(1, pageInfo.lastPage || 1);
      const hasNextPage = Boolean(pageInfo.hasNextPage);

      return { items, lastPage, hasNextPage };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function filtrarElegibles(items, watchedIds, lastShownId) {
    return items.filter(
      (item) =>
        !watchedIds.has(item.id) &&
        (items.length <= 1 || item.id !== lastShownId)
    );
  }

  async function pickRandomAnime() {
    const cacheKey = `anilist::${state.genre || 'all'}::${state.minScore || 'any'}::${
      state.modoPozo ? 'pozo' : 'normal'
    }`;

    try {
      let pool = poolCache.get(cacheKey);
      if (!pool) {
        const first = await fetchAniListPage(
          state.genre,
          state.minScore,
          1,
          state.modoPozo
        );
        const initialMax = first.hasNextPage ? Math.min(first.lastPage, 20) : 1;
        pool = {
          maxPage: initialMax,
          pages: new Map([[1, first.items]]),
        };
        poolCache.set(cacheKey, pool);
      }

      const watchedIds = getWatchedIdsSet();
      const maxAttempts = Math.min(5, Math.max(1, pool.maxPage));
      const triedPages = new Set();

      for (let i = 0; i < maxAttempts; i++) {
        const upper = Math.max(1, pool.maxPage);
        let page = 1 + Math.floor(Math.random() * upper);
        while (triedPages.has(page) && triedPages.size < upper) {
          page = 1 + (page % upper);
        }
        triedPages.add(page);

        let items = pool.pages.get(page);
        if (!items) {
          const res = await fetchAniListPage(
            state.genre,
            state.minScore,
            page,
            state.modoPozo
          );
          items = res.items;
          pool.pages.set(page, items);

          if (items.length === 0 && page > 1) {
            pool.maxPage = Math.min(pool.maxPage, page - 1);
            continue;
          }
          if (!res.hasNextPage) {
            pool.maxPage = Math.min(pool.maxPage, page);
          }
        }

        const eligible = filtrarElegibles(items, watchedIds, state.lastShownId);
        if (eligible.length > 0) {
          return eligible[Math.floor(Math.random() * eligible.length)];
        }
      }

      const fallbackPool = [];
      pool.pages.forEach((items) => {
        fallbackPool.push(...filtrarElegibles(items, watchedIds, null));
      });

      if (fallbackPool.length > 0) {
        const nonRepeat = fallbackPool.filter((item) => item.id !== state.lastShownId);
        const source = nonRepeat.length > 0 ? nonRepeat : fallbackPool;
        return source[Math.floor(Math.random() * source.length)];
      }

      throw new Error('NO_UNWATCHED_MATCHES');
    } catch (err) {
      if (err && err.message === 'NO_UNWATCHED_MATCHES') {
        throw new Error(
          'No quedan animes sin ver con estos filtros. Prueba bajar la puntuación o reiniciar tu historial.'
        );
      }
      if (err && typeof err.message === 'string' && err.message.startsWith('HTTP_')) {
        const code = err.message.replace('HTTP_', '');
        throw new Error(`Error HTTP ${code} al consultar AniList.`);
      }
      if (err && err.name === 'AbortError') {
        throw new Error(
          'La consulta a AniList tardó demasiado tiempo en responder. Inténtalo de nuevo.'
        );
      }
      throw new Error(
        'No se pudo conectar con AniList en este momento. Verifica tu conexión e inténtalo de nuevo.'
      );
    }
  }

  function renderSynopsis(fullText) {
    const isLong = fullText.length > 340;
    if (!isLong) {
      animeSynopsis.textContent = fullText;
      toggleSynopsisBtn.classList.add('is-hidden');
      return;
    }

    toggleSynopsisBtn.classList.remove('is-hidden');
    if (state.expandedSynopsis) {
      animeSynopsis.textContent = fullText;
      toggleSynopsisBtn.textContent = 'Mostrar menos';
    } else {
      animeSynopsis.textContent = `${fullText.slice(0, 340).trimEnd()}…`;
      toggleSynopsisBtn.textContent = 'Leer sinopsis completa';
    }
  }

  function renderAnimeCard(anime) {
    state.currentAnime = anime;
    state.lastShownId = anime.id;
    state.expandedSynopsis = false;

    const primaryTitle = anime.titleEnglish || anime.title;
    const secondaryTitle =
      anime.titleEnglish && anime.titleEnglish !== anime.title ? anime.title : null;
    const subtitles = [secondaryTitle, anime.titleJapanese].filter(Boolean).join(' · ');

    animeTitle.textContent = primaryTitle;
    animeSubtitles.textContent = subtitles;
    animeSubtitles.classList.toggle('is-hidden', !subtitles);

    animeScore.textContent = anime.score ? `★ ${anime.score.toFixed(2)}` : '★ N/D';
    if (pozoPopularityNote) {
      if (anime.fromPozo && typeof anime.popularity === 'number') {
        const vistos = formatearMiles(anime.popularity);
        const siguiente = formatearMiles(anime.popularity + 1);
        pozoPopularityNote.textContent = `Solo ${vistos} personas en el mundo han visto esto. Ahora tú eres la ${siguiente}.`;
        pozoPopularityNote.classList.remove('is-hidden');
      } else {
        pozoPopularityNote.textContent = '';
        pozoPopularityNote.classList.add('is-hidden');
      }
    }
    animeEpisodes.textContent = anime.episodes
      ? `${anime.episodes} episodios`
      : 'Episodios por confirmar';
    animeStatus.textContent = translateStatus(anime.status);

    if (anime.year) {
      animeYearSep.classList.remove('is-hidden');
      animeYear.textContent = String(anime.year);
    } else {
      animeYearSep.classList.add('is-hidden');
      animeYear.textContent = '';
    }

    posterFallbackTitle.textContent = primaryTitle;
    if (anime.imageUrl) {
      animePoster.classList.remove('is-hidden');
      posterFallback.classList.add('is-hidden');
      animePoster.alt = `Portada oficial de ${primaryTitle}`;
      animePoster.src = anime.imageUrl;
    } else {
      animePoster.classList.add('is-hidden');
      posterFallback.classList.remove('is-hidden');
    }

    animeGenres.textContent = (anime.genres || []).join(' / ');

    animeSynopsis.dataset.fullText = anime.synopsis;
    renderSynopsis(anime.synopsis);

    malLink.href = anime.url;
    malLink.textContent = anime.malId
      ? 'Ver ficha en MyAnimeList ↗'
      : 'Ver ficha completa ↗';

    updateMarkWatchedButton();
    if (shareCardBtn) {
      shareCardBtn.textContent = 'Compartir PNG';
      shareCardBtn.disabled = false;
    }
    // Prepara la ficha oculta antes de iniciar la línea de tiempo de revelación
    animeCard.classList.remove('visible');
    animeCard.classList.add('oculta');
    showStage('result');
  }

  function updateMarkWatchedButton() {
    if (!state.currentAnime) return;
    const isWatched = getWatchedIdsSet().has(state.currentAnime.id);
    markWatchedBtn.disabled = isWatched;
    markWatchedBtn.textContent = isWatched ? 'Marcado como visto' : 'Ya lo vi';
    markWatchedBtn.classList.toggle('btn-watched', isWatched);
    markWatchedBtn.classList.toggle('btn-secondary', !isWatched);
  }

  function renderWatchedHistory() {
    const count = state.watchedList.length;
    navWatchedCount.textContent = String(count);
    if (mobileWatchedCount) mobileWatchedCount.textContent = String(count);
    excludedCount.textContent = String(count);
    updateActiveRulesSummary();

    if (count === 0) {
      historySummary.textContent = 'Todavía no marcaste ningún título como visto.';
      if (historyEmptyBox) historyEmptyBox.classList.remove('is-hidden');
      resetControls.classList.add('is-hidden');
      watchedGrid.innerHTML = '';
      return;
    }

    if (historyEmptyBox) historyEmptyBox.classList.add('is-hidden');
    historySummary.textContent = `${count} ${
      count === 1 ? 'título guardado' : 'títulos guardados'
    } en tu navegador para no repetir recomendaciones.`;
    resetControls.classList.remove('is-hidden');

    watchedGrid.innerHTML = '';
    state.watchedList.forEach((entry) => {
      const card = document.createElement('div');
      card.className = 'watched-item';

      const main = document.createElement('div');
      main.className = 'watched-item-main';

      if (entry.image_url) {
        const img = document.createElement('img');
        img.className = 'watched-thumb';
        img.src = entry.image_url;
        img.alt = entry.title;
        img.referrerPolicy = 'no-referrer';
        main.appendChild(img);
      }

      const textBox = document.createElement('div');
      textBox.className = 'watched-text';

      const titleEl = document.createElement('p');
      titleEl.className = 'watched-title';
      titleEl.textContent = entry.title;

      const scoreEl = document.createElement('p');
      scoreEl.className = 'watched-score';
      scoreEl.textContent = entry.score
        ? `Puntuación ${Number(entry.score).toFixed(2)}`
        : 'Sin puntuación';

      textBox.appendChild(titleEl);
      textBox.appendChild(scoreEl);
      main.appendChild(textBox);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = 'Quitar';
      removeBtn.setAttribute('aria-label', `Quitar ${entry.title} del historial`);
      removeBtn.addEventListener('click', () => {
        state.watchedList = state.watchedList.filter((item) => item.id !== entry.id);
        saveWatched();
        renderWatchedHistory();
        updateMarkWatchedButton();
      });

      card.appendChild(main);
      card.appendChild(removeBtn);
      watchedGrid.appendChild(card);
    });
  }

  // Curva de desaceleración realista (easeOutQuart)
  function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
  }

  // Determina el índice del segmento ganador según el filtro o los géneros del anime elegido
  function obtenerIndiceGanador(anime) {
    if (state.genre) {
      const idxFiltro = WHEEL_SEGMENTS.findIndex((seg) => seg.genre === state.genre);
      if (idxFiltro !== -1) return idxFiltro;
    }

    if (anime && Array.isArray(anime.genres)) {
      const idxAnime = WHEEL_SEGMENTS.findIndex(
        (seg) =>
          seg.genre &&
          anime.genres.some((g) => String(g).toLowerCase() === seg.genre.toLowerCase())
      );
      if (idxAnime !== -1) return idxAnime;
    }

    return WHEEL_SEGMENTS.length - 1; // Segmento "Sorpresa"
  }

  // Calcula el ángulo final exacto para alinear el segmento ganador con el puntero superior
  function calcularAnguloFinal(indiceGanador, vueltasBaseDeg) {
    const anguloSegmento = 360 / WHEEL_SEGMENTS.length;
    const centroSegmento = indiceGanador * anguloSegmento + anguloSegmento / 2;
    const restoObjetivo = (360 - (centroSegmento % 360)) % 360;
    const actualNormalizado = ((state.rotation % 360) + 360) % 360;
    const offsetHastaGanador = (restoObjetivo - actualNormalizado + 360) % 360;

    return state.rotation + vueltasBaseDeg + offsetHastaGanador;
  }

  // Dispara el latido visual del puntero con intensidad proporcional a la velocidad
  function dispararTick(gradosRecorridos, deltaMs) {
    if (!pointerNeedle) return;

    // Convierte la velocidad instantánea (°/ms) a un rango entre -6deg (lento) y -16deg (rápido)
    const velocidadPorMs = gradosRecorridos / Math.max(deltaMs, 1);
    const intensidad = Math.min(Math.max(velocidadPorMs / 1.5, 0), 1);
    const anguloTick = -(6 + 10 * intensidad);

    pointerNeedle.style.setProperty('--tick-angle', `${anguloTick.toFixed(2)}deg`);
    pointerNeedle.classList.remove('is-ticking');
    // Fuerza un reflow para reiniciar la animación CSS de 90ms en cada cruce
    void pointerNeedle.offsetWidth;
    pointerNeedle.classList.add('is-ticking');
  }

  // Anima la rotación del SVG con requestAnimationFrame y desaceleración easeOutQuart
  function animarRuleta(
    elemento,
    anguloInicial,
    anguloFinal,
    duracion,
    permitirEfectosVisuales,
    alFinalizar
  ) {
    if (state.animationFrameId !== null) {
      window.cancelAnimationFrame(state.animationFrameId);
      state.animationFrameId = null;
    }

    elemento.style.filter = '';

    const tamanoSegmento = 360 / WHEEL_SEGMENTS.length;
    let ultimoSegmento = Math.floor(anguloInicial / tamanoSegmento);
    let anguloAnterior = anguloInicial;
    let tiempoInicio = null;
    let ultimoTimestamp = null;
    let ultimoBlur = 0;

    function cuadro(timestamp) {
      if (tiempoInicio === null) {
        tiempoInicio = timestamp;
        ultimoTimestamp = timestamp;
      }

      const deltaMs = Math.max(timestamp - ultimoTimestamp, 1);
      const progreso = Math.min((timestamp - tiempoInicio) / duracion, 1);
      const factorSuavizado = easeOutQuart(progreso);
      const anguloActual = anguloInicial + (anguloFinal - anguloInicial) * factorSuavizado;
      const velocidad = Math.abs(anguloActual - anguloAnterior); // grados recorridos en este frame

      elemento.style.transform = `rotate(${anguloActual}deg)`;

      // Motion blur continuo proporcional a la velocidad (versión continua activa; corta < 0.25px en el último tercio para evitar repaints y mantener nitidez al frenar)
      if (permitirEfectosVisuales && progreso < 1) {
        const blurBruto = Math.min(velocidad * (16.67 / deltaMs) * 0.1, 3);
        const blurAplicado = blurBruto >= 0.25 ? Number(blurBruto.toFixed(1)) : 0;

        if (blurAplicado !== ultimoBlur) {
          elemento.style.filter = blurAplicado > 0 ? `blur(${blurAplicado}px)` : '';
          ultimoBlur = blurAplicado;
        }
      }

      // Detecta el cruce de cada segmento para disparar el tick del puntero
      const segmentoActual = Math.floor(anguloActual / tamanoSegmento);
      if (permitirEfectosVisuales && segmentoActual !== ultimoSegmento) {
        dispararTick(velocidad, deltaMs);
        ultimoSegmento = segmentoActual;
      }

      anguloAnterior = anguloActual;
      ultimoTimestamp = timestamp;

      if (progreso < 1) {
        state.animationFrameId = window.requestAnimationFrame(cuadro);
      } else {
        // Fija exactamente el ángulo ganador y limpia el filter explícitamente al terminar
        elemento.style.transform = `rotate(${anguloFinal}deg)`;
        elemento.style.filter = '';
        state.rotation = anguloFinal;
        state.animationFrameId = null;
        alFinalizar();
      }
    }

    state.animationFrameId = window.requestAnimationFrame(cuadro);
  }

  // Elimina de inmediato cualquier pétalo pendiente de una revelación anterior
  function limpiarPetalos() {
    state.activePetals.forEach((petalo) => {
      window.clearTimeout(petalo.timerId);
      petalo.el.remove();
    });
    state.activePetals = [];
  }

  // Genera entre 8 y 12 pétalos de sakura al finalizar la secuencia de revelación
  function lanzarPetalosSakura() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    limpiarPetalos();

    const cantidad = 8 + Math.floor(Math.random() * 5);
    for (let i = 0; i < cantidad; i++) {
      const petaloEl = document.createElement('div');
      petaloEl.className = 'sakura-petalo';
      petaloEl.setAttribute('aria-hidden', 'true');

      const ancho = 8 + Math.random() * 6;
      const alto = 8 + Math.random() * 6;
      const leftPct = 5 + Math.random() * 90;
      const duracionS = 2 + Math.random() * 2;
      const retrasoMs = Math.round(Math.random() * 600);
      const opacidad = 0.6 + Math.random() * 0.3;
      const color = TONOS_SAKURA[Math.floor(Math.random() * TONOS_SAKURA.length)];

      petaloEl.style.width = `${ancho.toFixed(1)}px`;
      petaloEl.style.height = `${alto.toFixed(1)}px`;
      petaloEl.style.left = `${leftPct.toFixed(2)}%`;
      petaloEl.style.background = color;
      petaloEl.style.setProperty('--petalo-opacity', opacidad.toFixed(2));
      petaloEl.style.animationDuration = `${duracionS.toFixed(2)}s`;
      petaloEl.style.animationDelay = `${retrasoMs}ms`;

      const registro = { el: petaloEl, timerId: 0 };

      function eliminarPetalo() {
        window.clearTimeout(registro.timerId);
        petaloEl.remove();
        state.activePetals = state.activePetals.filter((item) => item !== registro);
      }

      petaloEl.addEventListener('animationend', eliminarPetalo, { once: true });
      registro.timerId = window.setTimeout(
        eliminarPetalo,
        Math.round(duracionS * 1000) + retrasoMs + 200
      );

      state.activePetals.push(registro);
      document.body.appendChild(petaloEl);
    }
  }

  // Cancela cualquier timer pendiente de una secuencia de revelación anterior
  function cancelarSecuenciaRevelacion() {
    state.revealTimers.forEach((timerId) => window.clearTimeout(timerId));
    state.revealTimers = [];
    rouletteSvg.querySelectorAll('.segmento-ganador').forEach((el) => {
      el.classList.remove('segmento-ganador');
    });
    const glowLayer = document.getElementById('winner-glow-layer');
    if (glowLayer) {
      glowLayer.classList.remove('is-active');
      glowLayer.innerHTML = '';
    }
  }

  // Construye el contenido SVG de la capa superpuesta del brillo ganador
  function renderWinnerGlowLayer(indiceGanador) {
    const glowLayer = document.getElementById('winner-glow-layer');
    const seg = WHEEL_SEGMENTS[indiceGanador];
    if (!glowLayer || !seg) return;

    const segmentAngle = 360 / WHEEL_SEGMENTS.length;
    const start = indiceGanador * segmentAngle;
    const end = start + segmentAngle;
    const mid = start + segmentAngle / 2;
    const pos = polarToCartesian(160, 160, 102, mid);
    const wedgePath = describeArcWedge(160, 160, 146, 48, start, end);

    glowLayer.innerHTML = [
      `<path d="${wedgePath}" fill="none" stroke="#F59E0B" stroke-width="7" stroke-linejoin="round" />`,
      `<path d="${wedgePath}" fill="#FDE68A" fill-opacity="0.45" stroke="#1C1B18" stroke-width="2.5" stroke-linejoin="round" />`,
      `<text x="${pos.x}" y="${pos.y}" fill="#1C1B18" font-size="11" font-weight="800" font-family="Bricolage Grotesque, sans-serif" text-anchor="middle" dominant-baseline="middle" transform="rotate(${mid + 90}, ${pos.x}, ${pos.y})">${seg.label}</text>`,
    ].join('');
  }

  // Orquesta la secuencia coreografiada tras detenerse la ruleta (0ms -> 400ms -> 800ms -> 1400ms)
  function ejecutarSecuenciaRevelacion(indiceGanador, prefiereMovimientoReducido) {
    cancelarSecuenciaRevelacion();

    if (prefiereMovimientoReducido) {
      // t+0ms: Sin brillo del segmento; ficha lista en .oculta (solo fade de 200ms)
      const timerFade = window.setTimeout(() => {
        animeCard.classList.remove('oculta');
        animeCard.classList.add('visible');
      }, 20);

      // t+240ms (<= 300ms): Fin de secuencia reducida y reactivación de botones
      const timerFin = window.setTimeout(() => {
        state.revealTimers = [];
        setSpinningUI(false);
      }, 240);

      state.revealTimers.push(timerFade, timerFin);
      return;
    }

    const segmentoPath = rouletteSvg.querySelector(
      `path.wheel-segment[data-segment-index="${indiceGanador}"]`
    );
    const glowLayer = document.getElementById('winner-glow-layer');
    renderWinnerGlowLayer(indiceGanador);

    // t+400ms: El segmento ganador resalta con un brillo dorado suave
    const timerBrillo = window.setTimeout(() => {
      if (segmentoPath) {
        segmentoPath.classList.add('segmento-ganador');
      }
      if (glowLayer) {
        glowLayer.classList.add('is-active');
      }
    }, 400);

    // t+800ms: La ficha del anime se desliza desde abajo con fade y ligero scale
    const timerFicha = window.setTimeout(() => {
      animeCard.classList.remove('oculta');
      animeCard.classList.add('visible');
    }, 800);

    // t+1400ms: Fin de la secuencia; inicia el desvanecimiento del brillo, se reactiva el botón y caen los pétalos
    const timerFin = window.setTimeout(() => {
      if (segmentoPath) {
        segmentoPath.classList.remove('segmento-ganador');
      }
      if (glowLayer) {
        glowLayer.classList.remove('is-active');
      }
      setSpinningUI(false);
      lanzarPetalosSakura();
    }, 1400);

    // t+1820ms: Limpia el contenido de la capa al completar el fade-out
    const timerLimpieza = window.setTimeout(() => {
      if (glowLayer) {
        glowLayer.innerHTML = '';
      }
      state.revealTimers = [];
    }, 1820);

    state.revealTimers.push(timerBrillo, timerFicha, timerFin, timerLimpieza);
  }

  async function handleSpin() {
    if (state.isSpinning) return;

    if (state.currentPage !== 'ruleta') {
      navigateTo('ruleta');
    }

    limpiarPetalos();
    cancelarSecuenciaRevelacion();
    state.confirmReset = false;
    updateResetUI();
    setSpinningUI(true);
    showStage('loading');

    const activeBtn = genreButtonsContainer.querySelector('.genre-btn.is-active');
    const genreLabel = activeBtn ? activeBtn.textContent : 'Todos';
    const partesFiltro = [genreLabel];
    if (state.minScore) partesFiltro.push(`+${state.minScore}`);
    if (state.modoPozo) partesFiltro.push('Pozo Olvidado');
    loadingDetail.textContent = `Filtrando por ${partesFiltro.join(' · ')}`;

    try {
      // Calcula primero el anime elegido y luego anima la ruleta hasta su segmento ganador
      const selected = await pickRandomAnime();
      const prefiereMovimientoReducido = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches;

      const duracion = prefiereMovimientoReducido
        ? DURACION_GIRO_REDUCIDO_MS
        : DURACION_GIRO_NORMAL_MS;
      const vueltasBase = prefiereMovimientoReducido
        ? VUELTAS_REDUCIDAS_DEG
        : VUELTAS_NORMALES_DEG;

      const indiceGanador = obtenerIndiceGanador(selected);
      const anguloInicial = state.rotation;
      const anguloFinal = calcularAnguloFinal(indiceGanador, vueltasBase);

      loadingDetail.textContent = prefiereMovimientoReducido
        ? 'Girando ruleta…'
        : 'Girando ruleta hacia tu recomendación…';

      animarRuleta(
        rouletteSvg,
        anguloInicial,
        anguloFinal,
        duracion,
        !prefiereMovimientoReducido,
        () => {
          // t+0ms: La ruleta se detiene; se rellena la ficha oculta y arranca la secuencia
          renderAnimeCard(selected);
          ejecutarSecuenciaRevelacion(indiceGanador, prefiereMovimientoReducido);
        }
      );
    } catch (error) {
      cancelarSecuenciaRevelacion();
      errorMessage.textContent =
        error && error.message
          ? error.message
          : 'No fue posible obtener una recomendación en este momento.';
      showStage('error');
      setSpinningUI(false);
    }
  }

  function updateResetUI() {
    cancelResetBtn.classList.toggle('is-hidden', !state.confirmReset);
    resetHistoryBtn.textContent = state.confirmReset
      ? 'Confirmar reinicio'
      : 'Reiniciar historial';
    resetHistoryBtn.classList.toggle('btn-danger', state.confirmReset);
    resetHistoryBtn.classList.toggle('btn-secondary', !state.confirmReset);
  }

  genreButtonsContainer.addEventListener('click', (event) => {
    const btn = event.target.closest('.genre-btn');
    if (!btn || state.isSpinning) return;

    genreButtonsContainer.querySelectorAll('.genre-btn').forEach((item) => {
      item.classList.remove('is-active');
    });
    btn.classList.add('is-active');
    state.genre = btn.dataset.genre || '';
    renderWheel();
    updateActiveRulesSummary();
  });

  minScoreSelect.addEventListener('change', (event) => {
    state.minScore = event.target.value;
    updateActiveRulesSummary();
  });

  if (pozoToggleBtn) {
    pozoToggleBtn.addEventListener('click', () => {
      if (state.isSpinning) return;
      state.modoPozo = !state.modoPozo;
      saveModoPozo();
      updatePozoUI();
      updateActiveRulesSummary();
    });
  }

  [headerSpinBtn, mainSpinBtn, wheelHubBtn, emptySpinBtn, retrySpinBtn, nextSpinBtn, spinFromFiltersBtn].forEach(
    (btn) => {
      if (btn) btn.addEventListener('click', handleSpin);
    }
  );

  function resetAllFilters() {
    state.genre = '';
    state.minScore = '';
    state.modoPozo = false;
    minScoreSelect.value = '';
    saveModoPozo();
    updatePozoUI();
    genreButtonsContainer.querySelectorAll('.genre-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.genre === '');
    });
    renderWheel();
    updateActiveRulesSummary();
  }

  clearFiltersBtn.addEventListener('click', () => {
    resetAllFilters();
    showStage('idle');
  });

  if (resetFiltersPageBtn) {
    resetFiltersPageBtn.addEventListener('click', () => {
      resetAllFilters();
    });
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-page-link]');
    if (!link) return;
    const targetPage = link.dataset.pageLink;
    if (targetPage === 'ruleta' || targetPage === 'filtros' || targetPage === 'historial' || targetPage === 'bitacora') {
      event.preventDefault();
      navigateTo(targetPage);
    }
  });

  window.addEventListener('hashchange', () => {
    renderPageVisibility(getPageFromHash());
  });

  animePoster.addEventListener('error', () => {
    animePoster.classList.add('is-hidden');
    posterFallback.classList.remove('is-hidden');
  });

  toggleSynopsisBtn.addEventListener('click', () => {
    state.expandedSynopsis = !state.expandedSynopsis;
    renderSynopsis(animeSynopsis.dataset.fullText || '');
  });

  markWatchedBtn.addEventListener('click', () => {
    if (!state.currentAnime) return;
    const watchedIds = getWatchedIdsSet();
    if (watchedIds.has(state.currentAnime.id)) return;

    state.watchedList.unshift({
      id: state.currentAnime.id,
      title: state.currentAnime.titleEnglish || state.currentAnime.title,
      image_url: state.currentAnime.imageUrl || null,
      score: state.currentAnime.score,
      watchedAt: Date.now(),
    });

    saveWatched();
    renderWatchedHistory();
    updateMarkWatchedButton();
  });

  // Dibuja un rectángulo redondeado auxiliar en el canvas
  function drawRoundedRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  // Divide texto largo en líneas dentro de un ancho máximo
  function wrapTextLines(ctx, text, maxWidth, maxLines) {
    const words = String(text || '').trim().split(/\s+/);
    const lines = [];
    let currentLine = '';

    for (let i = 0; i < words.length; i++) {
      const testLine = currentLine ? `${currentLine} ${words[i]}` : words[i];
      if (ctx.measureText(testLine).width <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = words[i];
        } else {
          lines.push(words[i]);
          currentLine = '';
        }
        if (lines.length === maxLines) break;
      }
    }

    if (currentLine && lines.length < maxLines) {
      lines.push(currentLine);
    } else if (currentLine && lines.length === maxLines) {
      let last = lines[maxLines - 1];
      while (last.length > 3 && ctx.measureText(`${last}…`).width > maxWidth) {
        last = last.slice(0, -1).trimEnd();
      }
      lines[maxLines - 1] = `${last}…`;
    }

    return lines;
  }

  function drawSakuraAccent(ctx, x, y, size, angleDeg, color, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((angleDeg * Math.PI) / 180);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.bezierCurveTo(size * 0.9, -size * 0.6, size * 0.9, size * 0.6, 0, size);
    ctx.bezierCurveTo(-size * 0.9, size * 0.6, -size * 0.9, -size * 0.6, 0, -size);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  async function blobToDrawable(blob) {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(blob);
      } catch {
        // Continúa con decodificación vía Data URL
      }
    }

    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = typeof reader.result === 'string' ? reader.result : '';
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }

  async function loadCorsImage(url) {
    if (!url) return null;

    const sep = url.includes('?') ? '&' : '?';
    const candidates = [url, `${url}${sep}_cors=${Date.now()}`];

    for (const candidateUrl of candidates) {
      try {
        const response = await fetch(candidateUrl, {
          mode: 'cors',
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        if (!response.ok) continue;
        const blob = await response.blob();
        const drawable = await blobToDrawable(blob);
        if (drawable) return drawable;
      } catch {
        // Intenta el siguiente candidato sin caché CORS
      }
    }

    return await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = candidates[1];
    });
  }

  // Genera una tarjeta PNG vertical (1080x1350) lista para Discord, Instagram o X
  async function generateShareCardBlob(anime) {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }

    const W = 1080;
    const H = 1350;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('No se pudo inicializar el lienzo de imagen.');
    }

    ctx.fillStyle = '#090B10';
    ctx.fillRect(0, 0, W, H);

    const topGlow = ctx.createRadialGradient(180, 120, 40, 180, 120, 620);
    topGlow.addColorStop(0, 'rgba(255, 77, 109, 0.22)');
    topGlow.addColorStop(1, 'rgba(255, 77, 109, 0)');
    ctx.fillStyle = topGlow;
    ctx.fillRect(0, 0, W, H);

    const bottomGlow = ctx.createRadialGradient(900, 1180, 30, 900, 1180, 560);
    bottomGlow.addColorStop(0, 'rgba(248, 200, 216, 0.14)');
    bottomGlow.addColorStop(1, 'rgba(248, 200, 216, 0)');
    ctx.fillStyle = bottomGlow;
    ctx.fillRect(0, 0, W, H);

    drawSakuraAccent(ctx, 940, 155, 14, 28, '#F8C8D8', 0.45);
    drawSakuraAccent(ctx, 985, 220, 10, -20, '#F4B8CC', 0.35);
    drawSakuraAccent(ctx, 130, 1170, 12, 42, '#FAD6E3', 0.3);
    drawSakuraAccent(ctx, 960, 1140, 15, -35, '#F8C8D8', 0.38);

    ctx.save();
    drawRoundedRect(ctx, 56, 56, W - 112, H - 112, 34);
    ctx.fillStyle = '#121620';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = '#FF4D6D';
    ctx.beginPath();
    ctx.arc(124, 124, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#121620';
    ctx.beginPath();
    ctx.arc(124, 124, 5.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#F4F6FB';
    ctx.font = '700 28px Outfit, sans-serif';
    ctx.fillText('AniRuleta', 152, 133);

    ctx.fillStyle = '#FF6B86';
    ctx.font = '700 18px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('MI DESTINO DE ANIME HOY', 110, 174);

    const badgeText = '100% SFW';
    ctx.font = '600 17px "JetBrains Mono", monospace';
    const badgeW = ctx.measureText(badgeText).width + 32;
    drawRoundedRect(ctx, W - 110 - badgeW, 108, badgeW, 38, 10);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#CBD5E1';
    ctx.fillText(badgeText, W - 110 - badgeW + 16, 133);
    ctx.restore();

    const posterImg = await loadCorsImage(anime.imageUrl);
    const showcaseX = 110;
    const showcaseY = 208;
    const showcaseW = W - 220;
    const showcaseH = 560;

    ctx.save();
    drawRoundedRect(ctx, showcaseX, showcaseY, showcaseW, showcaseH, 26);
    ctx.clip();
    ctx.fillStyle = '#0B0E14';
    ctx.fillRect(showcaseX, showcaseY, showcaseW, showcaseH);

    if (posterImg) {
      ctx.save();
      ctx.globalAlpha = 0.34;
      if ('filter' in ctx) {
        ctx.filter = 'blur(26px)';
      }
      const bgScale = Math.max(showcaseW / posterImg.width, showcaseH / posterImg.height);
      const bgW = posterImg.width * bgScale;
      const bgH = posterImg.height * bgScale;
      ctx.drawImage(
        posterImg,
        showcaseX + (showcaseW - bgW) / 2,
        showcaseY + (showcaseH - bgH) / 2,
        bgW,
        bgH
      );
      ctx.restore();

      const vignette = ctx.createLinearGradient(0, showcaseY, 0, showcaseY + showcaseH);
      vignette.addColorStop(0, 'rgba(9, 11, 16, 0.35)');
      vignette.addColorStop(1, 'rgba(9, 11, 16, 0.78)');
      ctx.fillStyle = vignette;
      ctx.fillRect(showcaseX, showcaseY, showcaseW, showcaseH);
    }
    ctx.restore();

    ctx.save();
    drawRoundedRect(ctx, showcaseX, showcaseY, showcaseW, showcaseH, 26);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    const posterH = 500;
    const posterW = 352;
    const posterX = (W - posterW) / 2;
    const posterY = showcaseY + (showcaseH - posterH) / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 16;
    drawRoundedRect(ctx, posterX, posterY, posterW, posterH, 20);
    ctx.fillStyle = '#0E121B';
    ctx.fill();
    ctx.restore();

    const primaryTitle = anime.titleEnglish || anime.title;

    ctx.save();
    drawRoundedRect(ctx, posterX, posterY, posterW, posterH, 20);
    ctx.clip();
    if (posterImg) {
      const scale = Math.max(posterW / posterImg.width, posterH / posterImg.height);
      const drawW = posterImg.width * scale;
      const drawH = posterImg.height * scale;
      ctx.drawImage(
        posterImg,
        posterX + (posterW - drawW) / 2,
        posterY + (posterH - drawH) / 2,
        drawW,
        drawH
      );
    } else {
      const fallbackGrad = ctx.createLinearGradient(
        posterX,
        posterY,
        posterX + posterW,
        posterY + posterH
      );
      fallbackGrad.addColorStop(0, '#1B2233');
      fallbackGrad.addColorStop(1, '#0F131D');
      ctx.fillStyle = fallbackGrad;
      ctx.fillRect(posterX, posterY, posterW, posterH);
      ctx.fillStyle = '#F4F6FB';
      ctx.font = '700 28px Outfit, sans-serif';
      ctx.textAlign = 'center';
      const fallbackLines = wrapTextLines(ctx, primaryTitle, posterW - 48, 4);
      fallbackLines.forEach((line, idx) => {
        ctx.fillText(line, posterX + posterW / 2, posterY + 210 + idx * 38);
      });
      ctx.textAlign = 'left';
    }
    ctx.restore();

    ctx.save();
    drawRoundedRect(ctx, posterX, posterY, posterW, posterH, 20);
    ctx.strokeStyle = 'rgba(255, 215, 130, 0.45)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    let cursorY = 825;
    const metaParts = [
      anime.episodes ? `${anime.episodes} episodios` : 'Episodios N/D',
      translateStatus(anime.status),
    ];
    if (anime.year) metaParts.push(String(anime.year));

    ctx.font = '700 24px "JetBrains Mono", monospace';
    const scoreText = `★ ${anime.score ? anime.score.toFixed(2) : 'N/D'}`;
    ctx.fillStyle = '#FBBF24';
    ctx.fillText(scoreText, 110, cursorY);

    const scoreWidth = ctx.measureText(scoreText).width;
    ctx.font = '500 23px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#94A3B8';
    ctx.fillText(`  ·  ${metaParts.join('  ·  ')}`, 110 + scoreWidth, cursorY);

    cursorY += 58;
    ctx.fillStyle = '#F4F6FB';
    ctx.font = '700 46px Outfit, sans-serif';
    const titleLines = wrapTextLines(ctx, primaryTitle, W - 220, 2);
    titleLines.forEach((line) => {
      ctx.fillText(line, 110, cursorY);
      cursorY += 56;
    });

    const secondaryTitle =
      anime.titleEnglish && anime.titleEnglish !== anime.title ? anime.title : null;
    const subtitle = [secondaryTitle, anime.titleJapanese].filter(Boolean).join(' · ');
    if (subtitle) {
      ctx.fillStyle = '#94A3B8';
      ctx.font = '500 23px "Plus Jakarta Sans", sans-serif';
      const subLines = wrapTextLines(ctx, subtitle, W - 220, 1);
      ctx.fillText(subLines[0], 110, cursorY);
      cursorY += 42;
    } else {
      cursorY += 10;
    }

    const genresToShow = (anime.genres || []).slice(0, 4);
    if (genresToShow.length > 0) {
      let tagX = 110;
      const tagY = cursorY + 8;
      ctx.font = '600 20px "Plus Jakarta Sans", sans-serif';

      for (const genre of genresToShow) {
        const textW = ctx.measureText(genre).width;
        const pillW = textW + 34;
        if (tagX + pillW > W - 110) break;

        drawRoundedRect(ctx, tagX, tagY, pillW, 42, 10);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#E2E8F0';
        ctx.fillText(genre, tagX + 17, tagY + 28);
        tagX += pillW + 12;
      }
    }

    ctx.fillStyle = '#F8C8D8';
    ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('«La ruleta ha hablado. Hoy toca ver este anime.»', 110, 1172);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(110, 1204);
    ctx.lineTo(W - 110, 1204);
    ctx.stroke();

    ctx.fillStyle = '#94A3B8';
    ctx.font = '500 20px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('Descubre el tuyo en AniRuleta', 110, 1246);

    ctx.save();
    ctx.textAlign = 'right';
    ctx.fillStyle = '#CBD5E1';
    ctx.font = '500 19px "JetBrains Mono", monospace';
    const sourceLabel = anime.malId
      ? `myanimelist.net/anime/${anime.malId}`
      : 'AniRuleta · Catálogo SFW';
    ctx.fillText(sourceLabel, W - 110, 1246);
    ctx.restore();

    if (posterImg && typeof posterImg.close === 'function') {
      posterImg.close();
    }

    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('No se pudo exportar la imagen PNG.'));
      }, 'image/png');
    });
  }

  function slugifyTitle(title) {
    return (
      String(title || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'anime'
    );
  }

  async function shareOrDownloadAnimeCard(anime) {
    const primaryTitle = anime.titleEnglish || anime.title;
    const blob = await generateShareCardBlob(anime);
    const fileName = `aniruleta-${slugifyTitle(primaryTitle)}.png`;
    const file = new File([blob], fileName, { type: 'image/png' });

    if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
      try {
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: `Mi destino de anime hoy: ${primaryTitle}`,
            text: `La ruleta de AniRuleta eligió: ${primaryTitle}`,
          });
          return 'shared';
        }
      } catch (err) {
        if (err && err.name === 'AbortError') return 'shared';
      }
    }

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    return 'downloaded';
  }

  if (shareCardBtn) {
    shareCardBtn.addEventListener('click', async () => {
      if (!state.currentAnime || state.isSpinning) return;
      shareCardBtn.disabled = true;
      shareCardBtn.textContent = 'Generando…';
      try {
        await shareOrDownloadAnimeCard(state.currentAnime);
        shareCardBtn.textContent = '¡Imagen lista!';
        window.setTimeout(() => {
          shareCardBtn.textContent = 'Compartir PNG';
          shareCardBtn.disabled = state.isSpinning;
        }, 2000);
      } catch {
        shareCardBtn.textContent = 'Compartir PNG';
        shareCardBtn.disabled = state.isSpinning;
      }
    });
  }

  cancelResetBtn.addEventListener('click', () => {
    state.confirmReset = false;
    updateResetUI();
  });

  resetHistoryBtn.addEventListener('click', () => {
    if (!state.confirmReset) {
      state.confirmReset = true;
      updateResetUI();
      return;
    }

    state.watchedList = [];
    state.confirmReset = false;
    saveWatched();
    renderWatchedHistory();
    updateMarkWatchedButton();
    updateResetUI();
  });

  renderPageVisibility(state.currentPage);
  updatePozoUI();
  updateActiveRulesSummary();
  renderWheel();
  renderWatchedHistory();
  showStage('idle');
})();
