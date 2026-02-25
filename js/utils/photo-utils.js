// AK Attendance - Photo Utilities
const PhotoUtils = {
    // Resize image to 640x480 and return as Blob
    async resizeImage(canvas, maxWidth = 640, maxHeight = 480) {
        return new Promise((resolve) => {
            // Create temporary canvas for resizing
            const tempCanvas = document.createElement('canvas');
            const ctx = tempCanvas.getContext('2d');

            // Calculate new dimensions maintaining aspect ratio
            let width = canvas.width;
            let height = canvas.height;

            if (width > maxWidth) {
                height = (height * maxWidth) / width;
                width = maxWidth;
            }

            if (height > maxHeight) {
                width = (width * maxHeight) / height;
                height = maxHeight;
            }

            tempCanvas.width = width;
            tempCanvas.height = height;

            // Draw resized image
            ctx.drawImage(canvas, 0, 0, width, height);

            // Convert to Blob
            tempCanvas.toBlob(
                (blob) => resolve(blob),
                'image/jpeg',
                0.85 // Quality 85%
            );
        });
    },

    // Capture photo from video element
    async captureFromVideo(videoElement, mirror = true) {
        const canvas = document.createElement('canvas');
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;

        const ctx = canvas.getContext('2d');

        // Mirror image if front camera
        if (mirror) {
            ctx.scale(-1, 1);
            ctx.drawImage(videoElement, -canvas.width, 0);
        } else {
            ctx.drawImage(videoElement, 0, 0);
        }

        // Reset transform
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        return canvas;
    },

    // Capture and resize photo from video
    async capturePhoto(videoElement, mirror = true) {
        const canvas = await this.captureFromVideo(videoElement, mirror);
        const blob = await this.resizeImage(canvas);
        return { canvas, blob };
    },

    // Convert Blob to Base64 (for display)
    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    },

    // Create thumbnail URL from photo URL
    getThumbnailUrl(photoUrl, width = 100) {
        if (!photoUrl) return null;
        // Supabase Storage supports image transformations
        // Add width parameter for thumbnail
        if (photoUrl.includes('supabase')) {
            return `${photoUrl}?width=${width}`;
        }
        return photoUrl;
    },

    // Open photo in new tab (full size)
    openFullSize(photoUrl) {
        if (photoUrl) {
            window.open(photoUrl, '_blank');
        }
    },

    // Create image element from URL
    createImageElement(photoUrl, alt = 'Photo', className = '') {
        const img = document.createElement('img');
        img.src = photoUrl;
        img.alt = alt;
        img.className = className;
        img.style.cursor = 'pointer';
        img.onclick = () => this.openFullSize(photoUrl);
        return img;
    }
};