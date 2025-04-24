document.addEventListener("DOMContentLoaded", function () {
  // Intersection Observer for fade-in animation on sections
  const sections = document.querySelectorAll(".content-section");
  const options = {
    threshold: 0.1,
  };

  const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  }, options);

  sections.forEach((section) => {
    observer.observe(section);
  });

  // Back-to-top button functionality using scroll event
  const backToTopBtn = document.getElementById("back-to-top");

  window.addEventListener("scroll", function () {
    if (window.scrollY > 100) {
      backToTopBtn.classList.add("show");
    } else {
      backToTopBtn.classList.remove("show");
    }
  });

  backToTopBtn.addEventListener("click", function () {
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  });


});
