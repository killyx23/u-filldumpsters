import React from 'react';
import { format, parseISO } from 'date-fns';
import { Check, CheckCircle2, Clock, FileText, AlertCircle } from 'lucide-react';
import { FeedbackSurveyMessageContent } from '@/components/chat/FeedbackSurveyMessageContent';
import { isHowCanWeDoBetterMessage } from '@/utils/feedbackSurveyMessage';

export const MessageBubble = ({ message, isCurrentUser, senderName }) => {
    const isTemp = message.id.toString().startsWith('temp_');
    const isError = message.status === 'error';
    const severity = message.message_severity || message.message_context?.severity || null;
    const isFeedbackSurvey = isHowCanWeDoBetterMessage(message);

    const severityStyles = {
        success: 'bg-green-700 text-green-50 border border-green-400/40',
        warning: 'bg-yellow-700 text-yellow-50 border border-yellow-300/50',
        urgent: 'bg-red-700 text-red-50 border border-red-300/60',
        info: 'bg-indigo-700 text-indigo-50 border border-indigo-300/40',
    };

    const feedbackBubbleClasses =
        'bg-slate-900/95 text-white border border-amber-400/30 rounded-bl-none shadow-lg shadow-black/30';

    const bubbleClasses = isFeedbackSurvey
        ? feedbackBubbleClasses
        : isCurrentUser
        ? 'bg-blue-600 text-white rounded-br-none'
        : severity && severityStyles[severity]
            ? `${severityStyles[severity]} rounded-bl-none`
            : 'bg-gray-700 text-white rounded-bl-none';

    const alignClasses = isCurrentUser ? 'items-end' : 'items-start';
    const widthClasses = isFeedbackSurvey
        ? 'max-w-[95%] sm:max-w-[90%] md:max-w-[85%]'
        : 'max-w-[85%] sm:max-w-[75%]';
    const absoluteLegacyUrl = typeof message.attachment_url === 'string' && /^https?:\/\//i.test(message.attachment_url)
        ? message.attachment_url
        : null;
    const attachmentHref = message.resolved_attachment_url || absoluteLegacyUrl;
    const isImageAttachment = message.attachment_name?.match(/\.(jpg|jpeg|png|gif|webp)$/i);

    return (
        <div className={`flex flex-col gap-1 w-full my-2 ${alignClasses}`}>
            <div className={`p-3 ${widthClasses} rounded-2xl shadow-md ${bubbleClasses} relative group`}>
                {!isFeedbackSurvey && (
                    <p className="text-xs font-semibold opacity-70 mb-1">
                        {isCurrentUser ? 'You' : senderName}
                    </p>
                )}
                {isFeedbackSurvey ? (
                    <FeedbackSurveyMessageContent message={message} />
                ) : (
                    message.message_content && (
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.message_content}</p>
                    )
                )}
                {!isCurrentUser && severity && !isFeedbackSurvey && (
                    <p className="text-[10px] uppercase tracking-wider mt-2 opacity-80 font-semibold">
                        {severity}
                    </p>
                )}
                {(message.attachment_url || message.attachment_name) && (
                    attachmentHref ? (
                        <a href={attachmentHref} target="_blank" rel="noopener noreferrer" className="mt-2 block bg-black/20 p-2 rounded-lg flex items-center gap-2 hover:bg-black/40 transition-colors">
                            {isImageAttachment ? (
                                 <img src={attachmentHref} alt="attachment" className="max-w-[200px] rounded object-cover" />
                            ) : (
                                <>
                                    <FileText className="h-4 w-4 text-yellow-400" />
                                    <span className="text-xs font-medium truncate max-w-[150px]">{message.attachment_name || 'Attachment'}</span>
                                </>
                            )}
                        </a>
                    ) : (
                        <div className="mt-2 bg-black/20 p-2 rounded-lg flex items-center gap-2">
                            <FileText className="h-4 w-4 text-yellow-400" />
                            <span className="text-xs font-medium truncate max-w-[150px]">{message.attachment_name || 'Attachment unavailable'}</span>
                        </div>
                    )
                )}

                <div className="flex items-center justify-end gap-1 mt-2 opacity-70">
                    <span className="text-[10px]">{format(parseISO(message.created_at), 'p')}</span>
                    {isCurrentUser && (
                        <span className="ml-1">
                            {isError ? <AlertCircle className="w-3 h-3 text-red-400" /> :
                             isTemp ? <Clock className="w-3 h-3" /> :
                             message.is_read ? <CheckCircle2 className="w-3 h-3 text-green-300" /> :
                             <Check className="w-3 h-3" />}
                        </span>
                    )}
                </div>
            </div>
            {isError && <span className="text-[10px] text-red-400 px-1">Failed to send. Please try again.</span>}
        </div>
    );
};
