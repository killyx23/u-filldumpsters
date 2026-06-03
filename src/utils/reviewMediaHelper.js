import { supabase } from '@/lib/customSupabaseClient';

const BUCKET = 'customer-uploads';
const SIGNED_URL_TTL_SECONDS = 3600;

export const MAX_REVIEW_IMAGES = 5;
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024;

export const REVIEW_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const REVIEW_VIDEO_TYPES = [
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-m4v',
    'video/3gpp',
];

const EXTENSION_TO_VIDEO_MIME = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    '3gp': 'video/3gpp',
};

const isAbsoluteUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value);

const buildReviewMediaPath = (customerId, bookingId, folder, fileName) =>
    `${customerId}/${folder}/${bookingId}/${Date.now()}-${fileName}`;

const buildReviewResponseMediaPath = (customerId, reviewId, folder, fileName) =>
    `${customerId}/${folder}/${reviewId}/${Date.now()}-${fileName}`;

const getExtension = (fileName) => {
    const ext = fileName?.split('.').pop()?.toLowerCase();
    return ext || '';
};

export const resolveReviewVideoMime = (file) => {
    if (file.type && REVIEW_VIDEO_TYPES.includes(file.type)) {
        return file.type;
    }
    const fromExtension = EXTENSION_TO_VIDEO_MIME[getExtension(file.name)];
    return fromExtension || file.type || '';
};

export const formatReviewUploadError = (err) => {
    const message = err?.message || 'Something went wrong. Please try again.';
    if (/mime type/i.test(message) && /not supported/i.test(message)) {
        return 'Video uploads are not enabled on the server yet. Please try again later or contact support.';
    }
    return message;
};

const uploadToBucket = async (filePath, file, contentType) => {
    const { error } = await supabase.storage.from(BUCKET).upload(filePath, file, {
        contentType,
    });
    if (error) throw error;
    return filePath;
};

export async function uploadReviewImage(customerId, bookingId, file) {
    if (!REVIEW_IMAGE_TYPES.includes(file.type)) {
        throw new Error('Images must be JPEG, PNG, or WebP.');
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
        throw new Error('Each image must be under 10MB.');
    }

    const filePath = buildReviewMediaPath(customerId, bookingId, 'review-images', file.name);
    return uploadToBucket(filePath, file, file.type);
}

export async function uploadReviewVideo(customerId, bookingId, file) {
    const contentType = resolveReviewVideoMime(file);
    if (!REVIEW_VIDEO_TYPES.includes(contentType)) {
        throw new Error('Video must be MP4, WebM, or MOV.');
    }
    if (file.size > MAX_VIDEO_SIZE_BYTES) {
        throw new Error('Video must be under 50MB.');
    }

    const filePath = buildReviewMediaPath(customerId, bookingId, 'review-videos', file.name);
    return uploadToBucket(filePath, file, contentType);
}

export async function uploadReviewResponseImage(customerId, reviewId, file) {
    if (!REVIEW_IMAGE_TYPES.includes(file.type)) {
        throw new Error('Images must be JPEG, PNG, or WebP.');
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
        throw new Error('Each image must be under 10MB.');
    }

    const filePath = buildReviewResponseMediaPath(customerId, reviewId, 'review-response-images', file.name);
    return uploadToBucket(filePath, file, file.type);
}

export async function uploadReviewResponseVideo(customerId, reviewId, file) {
    const contentType = resolveReviewVideoMime(file);
    if (!REVIEW_VIDEO_TYPES.includes(contentType)) {
        throw new Error('Video must be MP4, WebM, or MOV.');
    }
    if (file.size > MAX_VIDEO_SIZE_BYTES) {
        throw new Error('Video must be under 50MB.');
    }

    const filePath = buildReviewResponseMediaPath(customerId, reviewId, 'review-response-videos', file.name);
    return uploadToBucket(filePath, file, contentType);
}

export async function resolveReviewMediaUrl(pathOrUrl) {
    if (!pathOrUrl) return null;
    if (isAbsoluteUrl(pathOrUrl)) return pathOrUrl;

    const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(pathOrUrl, SIGNED_URL_TTL_SECONDS);

    if (error) {
        console.warn('[reviewMediaHelper] Failed to create signed URL:', error);
        const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(pathOrUrl);
        return publicData?.publicUrl || null;
    }

    return data?.signedUrl || null;
}

export async function getReviewImageUrls(imageUrls) {
    if (!imageUrls?.length) return [];
    const resolved = await Promise.all(imageUrls.map(resolveReviewMediaUrl));
    return resolved.filter(Boolean);
}

export async function getReviewResponseImageUrls(imageUrls) {
    if (!imageUrls?.length) return [];
    const resolved = await Promise.all(imageUrls.map(resolveReviewMediaUrl));
    return resolved.filter(Boolean);
}

export async function hydrateReviewMedia(review) {
    const resolvedImageUrls = await getReviewImageUrls(review.image_urls);
    const resolvedVideoUrl = review.video_url
        ? await resolveReviewMediaUrl(review.video_url)
        : null;

    return {
        ...review,
        resolvedImageUrls,
        resolvedVideoUrl,
    };
}

export async function hydrateReviewResponseMedia(review) {
    const resolvedAdminResponseImageUrls = await getReviewResponseImageUrls(review.admin_response_image_urls);
    const resolvedAdminResponseVideoUrl = review.admin_response_video_url
        ? await resolveReviewMediaUrl(review.admin_response_video_url)
        : null;

    return {
        ...review,
        resolvedAdminResponseImageUrls,
        resolvedAdminResponseVideoUrl,
    };
}
