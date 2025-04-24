//gallery.js
document.addEventListener("DOMContentLoaded", function () {
  const galleryGrid = document.querySelector(".gallery-grid");
  const modal = document.getElementById("gallery-modal");
  const modalImage = document.getElementById("modal-image");
  const modalClose = document.querySelector(".modal-close");
  const downloadButton = document.getElementById("download-button");

  if (galleryGrid) {
    galleryGrid.addEventListener("click", function (e) {
      if (e.target && e.target.tagName === "IMG") {
        modal.classList.add("active");
        modalImage.src = e.target.src;
        downloadButton.href = e.target.src;
      }
    });
  }

  if (modalClose) {
    modalClose.addEventListener("click", function () {
      modal.classList.remove("active");
    });
  }

  // Close modal when clicking outside the image
  modal.addEventListener("click", function (e) {
    if (e.target === modal) {
      modal.classList.remove("active");
    }
  });

  // Close modal when pressing the Escape key
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modal.classList.contains("active")) {
      modal.classList.remove("active");
    }
  });
});
  