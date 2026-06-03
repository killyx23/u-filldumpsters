export function reviewNeedsExpand(review) {
    const title = review?.title?.trim() || '';
    const content = review?.content?.trim() || '';
    const hasCustomerMedia = Boolean(review?.image_urls?.length) || Boolean(review?.video_url);
    const hasAdminResponse =
        Boolean(review?.admin_response_text?.trim()) ||
        Boolean(review?.admin_response_image_urls?.length) ||
        Boolean(review?.admin_response_video_url);

    return (
        title.length > 48 ||
        content.length > 150 ||
        hasCustomerMedia ||
        hasAdminResponse
    );
}
