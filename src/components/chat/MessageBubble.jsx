import React from 'react';
import { format, parseISO } from 'date-fns';
import { Check, CheckCircle2, Clock, FileText, AlertCircle } from 'lucide-react';

export const MessageBubble = ({ message, isCurrentUser, senderName }) => {
    const isTemp = message.id.toString().startsWith('temp_');
    const isError = message.status === 'error';
    
    const bubbleClasses = isCurrentUser
        ? 'bg-blue-600 text-white rounded-br-none'
        : 'bg-gray-700 text-white rounded-bl-none';
        
    const alignClasses = isCurrentUser ? 'items-end' : 'items-start';

    return (
        <div className={`flex flex-col gap-1 w-full my-2 ${alignClasses}`}>
            <div className={`p-3 max-w-[85%] sm:max-w-[75%] rounded-2xl shadow-md ${bubbleClasses} relative group`}>
                <p className="text-xs font-semibold opacity-70 mb-1">
                    {isCurrentUser ? 'You' : senderName}
                </p>
                {message.message_content && (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.message_content}</p>
                )}
                {message.attachment_url && (
                    <a href={message.attachment_url} target="_blank" rel="noopener noreferrer" className="mt-2 block bg-black/20 p-2 rounded-lg flex items-center gap-2 hover:bg-black/40 transition-colors">
                        {message.attachment_name?.match(/\.(jpg|jpeg|png|gif)$/i) ? (
                             <img src={message.attachment_url} alt="attachment" className="max-w-[200px] rounded object-cover" />
                        ) : (
                            <>
                                <FileText className="h-4 w-4 text-yellow-400" /> 
                                <span className="text-xs font-medium truncate max-w-[150px]">{message.attachment_name || 'Attachment'}</span>
                            </>
                        )}
                    </a>
                )}
                
                <div className="flex items-center justify-end gap-1 mt-1 opacity-70">
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