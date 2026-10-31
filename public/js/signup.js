(async () => {
  const me = await boot();
  if (me.user) location.href = '/home.html';

  const O = await api('/options');
  const state = { step: 1, mood: 'okay', movie: null, book: null };
  const TOTAL = 6;

  const chips = {
    age: chipGroup($('#age'), O.ageGroups, { single: true }),
    occupation: chipGroup($('#occupation'), O.occupations, { single: true }),
    movieGenres: chipGroup($('#movie-genres'), O.movieGenres),
    bookGenres: chipGroup($('#book-genres'), O.bookGenres),
    music: chipGroup($('#music'), O.musicFamilies),
    daily: chipGroup($('#daily'), O.dailyActivities),
    unwind: chipGroup($('#unwind'), O.unwind),
    sleep: chipGroup($('#sleep'), O.sleepHours, { single: true }),
    screen: chipGroup($('#screen'), O.screenTime, { single: true }),
    hoping: chipGroup($('#hoping'), O.hopingFor, { single: true }),
  };
  moodPicker($('#mood'), { selected: 'okay', onPick: m => { state.mood = m; applyMood(m); } });

  // Autocomplete against the MovieLens / goodbooks datasets. Free text is still allowed.
  function autocomplete(kind, input, list, picked, onPick) {
    let timer;
    let items = [];
    const close = () => { list.classList.add('hidden'); input.setAttribute('aria-expanded', 'false'); };
    input.addEventListener('input', () => {
      onPick(null, input.value.trim());
      picked.textContent = '';
      clearTimeout(timer);
      timer = setTimeout(async () => {
        items = await api(`/search/${kind}?q=${encodeURIComponent(input.value)}`);
        if (!items.length) return close();
        list.innerHTML = items.map((it, i) => `<li role="option" data-i="${i}">${esc(it.title)}
          <small>${esc([it.author, it.year].filter(Boolean).join(' · '))}</small></li>`).join('');
        list.classList.remove('hidden');
        input.setAttribute('aria-expanded', 'true');
      }, 180);
    });
    list.addEventListener('mousedown', e => {
      const li = e.target.closest('li');
      if (!li) return;
      e.preventDefault();
      const it = items[li.dataset.i];
      input.value = it.title;
      picked.textContent = `✓ ${it.genres.filter(g => g !== 'IMAX').join(' · ')}`;
      onPick(it, it.title);
      close();
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }
  autocomplete('movies', $('#movie'), $('#movie-list'), $('#movie-picked'), (it, text) => { state.movie = it; state.movieText = text; });
  autocomplete('books', $('#book'), $('#book-list'), $('#book-picked'), (it, text) => { state.book = it; state.bookText = text; });

  const showError = msg => { $('#error').textContent = msg; $('#error').classList.toggle('hidden', !msg); };

  function validate(step) {
    if (step === 1) {
      if (!$('#name').value.trim()) return 'Please tell us your name.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($('#email').value.trim())) return 'Please enter a valid email.';
      if ($('#password').value.length < 8) return 'Your password needs at least 8 characters.';
    }
    if (step === 4 && !chips.music.get().length) return 'Pick at least one kind of music — it helps us find songs for you.';
    return '';
  }

  function render() {
    $$('.step').forEach(s => { s.hidden = Number(s.dataset.step) !== state.step; });
    $('#bar').style.width = `${(state.step / TOTAL) * 100}%`;
    $('#back').style.visibility = state.step === 1 ? 'hidden' : 'visible';
    $('#next').textContent = state.step === TOTAL ? 'Create my space ✨' : 'Continue';
    showError('');
    $(`.step[data-step="${state.step}"] input, .step[data-step="${state.step}"] button`)?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  $('#back').addEventListener('click', () => { state.step = Math.max(1, state.step - 1); render(); });

  $('#wizard').addEventListener('submit', async e => {
    e.preventDefault();
    const problem = validate(state.step);
    if (problem) return showError(problem);
    if (state.step < TOTAL) { state.step++; return render(); }

    const btn = $('#next');
    btn.disabled = true;
    btn.textContent = 'Setting things up…';
    try {
      const { redirect } = await api('/auth/signup', {
        method: 'POST',
        body: {
          name: $('#name').value,
          email: $('#email').value,
          password: $('#password').value,
          mood: state.mood,
          profile: {
            age_group: chips.age.getOne(),
            occupation: chips.occupation.getOne(),
            recent_movie_id: state.movie?.id ?? null,
            recent_movie: state.movieText || null,
            movie_genres: chips.movieGenres.get(),
            recent_book_id: state.book?.id ?? null,
            recent_book: state.bookText || null,
            book_genres: chips.bookGenres.get(),
            music_families: chips.music.get(),
            favourite_artist: $('#artist').value,
            daily_activities: chips.daily.get(),
            unwind: chips.unwind.get(),
            sleep_hours: chips.sleep.getOne(),
            screen_time: chips.screen.getOne(),
            hoping_for: chips.hoping.getOne(),
          },
        },
      });
      applyMood(state.mood);
      location.href = redirect;
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Create my space ✨';
      // Account problems (e.g. email taken) belong to step 1.
      if (/email|password|name/i.test(err.message)) { state.step = 1; render(); }
      showError(err.message);
    }
  });

  render();
})();
