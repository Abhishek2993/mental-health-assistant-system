// Shared by the user and therapist sign-in pages; the form's data-role picks the portal.
(async () => {
  const me = await boot();
  if (me.user) location.href = me.user.role === 'therapist' ? '/therapist/dashboard.html' : '/home.html';

  const form = $('#login');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    $('#error').classList.add('hidden');
    try {
      const { redirect } = await api('/auth/login', {
        method: 'POST',
        body: { email: $('#email').value, password: $('#password').value, role: form.dataset.role },
      });
      location.href = redirect;
    } catch (err) {
      $('#error').textContent = err.message;
      $('#error').classList.remove('hidden');
      btn.disabled = false;
    }
  });
})();
