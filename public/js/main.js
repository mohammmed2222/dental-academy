document.addEventListener('DOMContentLoaded', function() {
  var alerts = document.querySelectorAll('.alert');
  alerts.forEach(function(alert) {
    setTimeout(function() {
      alert.style.transition = 'opacity 0.3s ease';
      alert.style.opacity = '0';
      setTimeout(function() { alert.remove(); }, 300);
    }, 5000);
  });

  var quizOptions = document.querySelectorAll('.quiz-option input[type="radio"]');
  quizOptions.forEach(function(radio) {
    radio.addEventListener('change', function() {
      var parent = this.closest('.quiz-question');
      parent.querySelectorAll('.quiz-option').forEach(function(opt) {
        opt.classList.remove('selected');
      });
      this.closest('.quiz-option').classList.add('selected');
    });
  });
});

function confirmDelete(message) {
  return confirm(message || 'هل أنت متأكد؟');
}
