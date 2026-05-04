
import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import { Bot, Send, Loader2, MessageSquare, AlertCircle, CheckCircle } from 'lucide-react';
import { fetchFAQs, fetchKnowledgeBase, findRelevantAnswer, shouldShowFAQAnswer, submitFallbackMessage } from '@/services/AIAssistantService';
import { BusinessHoursDisplay } from './BusinessHoursDisplay';
import { motion, AnimatePresence } from 'framer-motion';

export const AIAssistant = ({ customer }) => {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'assistant',
      content: "👋 Hi! I'm your AI assistant. I can help answer common questions about our services, bookings, and policies. How can I help you today?",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [knowledgeBase, setKnowledgeBase] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [showFallbackForm, setShowFallbackForm] = useState(false);
  const [fallbackData, setFallbackData] = useState({
    name: customer?.name || `${customer?.first_name || ''} ${customer?.last_name || ''}`.trim(),
    email: customer?.email || '',
    order_number: '',
    message: ''
  });
  const [submittingFallback, setSubmittingFallback] = useState(false);
  const chatContainerRef = useRef(null);

  // Load knowledge base and FAQs on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const [kbData, faqData] = await Promise.all([
          fetchKnowledgeBase(),
          fetchFAQs()
        ]);
        setKnowledgeBase(kbData);
        setFaqs(faqData);
        console.log('[AIAssistant] Loaded', kbData.length, 'KB entries and', faqData.length, 'FAQs');
      } catch (error) {
        toast({
          title: 'Failed to load knowledge base',
          description: error.message,
          variant: 'destructive'
        });
      } finally {
        setDataLoading(false);
      }
    };

    loadData();
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = {
      id: Date.now().toString(),
      sender: 'user',
      content: input.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      // Find relevant answer from knowledge base or FAQs
      const { entry, confidence, source } = await findRelevantAnswer(
        userMessage.content,
        knowledgeBase,
        faqs
      );

      // Wait a bit to simulate thinking
      await new Promise(resolve => setTimeout(resolve, 500));

      if (shouldShowFAQAnswer(confidence)) {
        // High confidence - show answer
        let content, relatedQuestion;

        if (source === 'knowledge_base') {
          content = entry.content;
          relatedQuestion = entry.title;
        } else {
          content = entry.answer;
          relatedQuestion = entry.question;
        }

        const assistantMessage = {
          id: (Date.now() + 1).toString(),
          sender: 'assistant',
          content,
          timestamp: new Date(),
          confidence,
          relatedQuestion,
          source
        };

        setMessages(prev => [...prev, assistantMessage]);
        setShowFallbackForm(false);
      } else {
        // Low confidence - suggest fallback
        const assistantMessage = {
          id: (Date.now() + 1).toString(),
          sender: 'assistant',
          content: "I'm not quite sure how to answer that question. Would you like to leave a message for our support team? They'll get back to you as soon as possible.",
          timestamp: new Date(),
          confidence,
          suggestFallback: true
        };

        setMessages(prev => [...prev, assistantMessage]);
        setShowFallbackForm(true);
        setFallbackData(prev => ({ ...prev, message: userMessage.content }));
      }
    } catch (error) {
      console.error('[AIAssistant] Error processing message:', error);
      toast({
        title: 'Error',
        description: 'Failed to process your message. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitFallback = async (e) => {
    e.preventDefault();
    setSubmittingFallback(true);

    try {
      await submitFallbackMessage({
        customer_id: customer.id,
        ...fallbackData
      });

      toast({
        title: 'Message Sent',
        description: 'Our support team will review your message and respond during business hours.'
      });

      // Add confirmation message
      const confirmationMessage = {
        id: Date.now().toString(),
        sender: 'assistant',
        content: "✅ Your message has been sent to our support team. We'll get back to you as soon as possible during business hours. Is there anything else I can help you with?",
        timestamp: new Date()
      };

      setMessages(prev => [...prev, confirmationMessage]);
      setShowFallbackForm(false);
      setFallbackData({
        name: customer?.name || `${customer?.first_name || ''} ${customer?.last_name || ''}`.trim(),
        email: customer?.email || '',
        order_number: '',
        message: ''
      });
    } catch (error) {
      toast({
        title: 'Failed to send message',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSubmittingFallback(false);
    }
  };

  if (dataLoading) {
    return (
      <div className="flex justify-center items-center h-[400px]">
        <div className="text-center space-y-3">
          <Loader2 className="h-10 w-10 animate-spin text-blue-400 mx-auto" />
          <p className="text-gray-400 text-sm">Loading AI Assistant...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <BusinessHoursDisplay />

      <Card className="bg-gray-800 border-gray-700 flex flex-col h-[600px] shadow-2xl">
        <CardHeader className="py-3 border-b border-gray-700 bg-gray-900/50">
          <div className="flex items-center gap-3">
            <div className="bg-blue-500/20 p-2 rounded-full">
              <Bot className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-lg text-white flex items-center gap-2">
                AI Assistant
                <span className="text-xs font-normal text-gray-400 bg-gray-700 px-2 py-0.5 rounded">Beta</span>
              </CardTitle>
              <CardDescription className="text-gray-400 text-sm">
                Instant answers from our knowledge base
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4" ref={chatContainerRef}>
          <AnimatePresence>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[80%] ${msg.sender === 'user' ? 'ai-user-message' : 'ai-assistant-message'}`}>
                  {msg.sender === 'assistant' && (
                    <div className="flex items-center gap-2 mb-2">
                      <Bot className="h-4 w-4 text-blue-400" />
                      <span className="text-xs text-gray-400">AI Assistant</span>
                      {msg.confidence !== undefined && (
                        <span className={`text-xs px-2 py-0.5 rounded ${msg.confidence >= 0.6 ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                          {Math.round(msg.confidence * 100)}% match
                        </span>
                      )}
                      {msg.source && (
                        <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">
                          {msg.source === 'knowledge_base' ? 'KB' : 'FAQ'}
                        </span>
                      )}
                    </div>
                  )}
                  <div className={`rounded-lg p-3 ${msg.sender === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-100'}`}>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    {msg.relatedQuestion && (
                      <p className="text-xs mt-2 pt-2 border-t border-gray-600 text-gray-300">
                        Related to: "{msg.relatedQuestion}"
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-start"
            >
              <div className="bg-gray-700 rounded-lg p-3 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                <span className="text-sm text-gray-300">Thinking...</span>
              </div>
            </motion.div>
          )}

          {showFallbackForm && !loading && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <Card className="bg-gray-700/50 border-yellow-500/30">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base text-white flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-yellow-400" />
                    Leave a Message for Support
                  </CardTitle>
                  <CardDescription className="text-gray-400 text-sm">
                    Our team will respond during business hours
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmitFallback} className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="fallback-name" className="text-gray-300 text-sm">Name</Label>
                        <Input
                          id="fallback-name"
                          value={fallbackData.name}
                          onChange={(e) => setFallbackData(prev => ({ ...prev, name: e.target.value }))}
                          required
                          className="bg-gray-800 border-gray-600 text-white mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="fallback-email" className="text-gray-300 text-sm">Email</Label>
                        <Input
                          id="fallback-email"
                          type="email"
                          value={fallbackData.email}
                          onChange={(e) => setFallbackData(prev => ({ ...prev, email: e.target.value }))}
                          required
                          className="bg-gray-800 border-gray-600 text-white mt-1"
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="fallback-order" className="text-gray-300 text-sm">Order Number (Optional)</Label>
                      <Input
                        id="fallback-order"
                        value={fallbackData.order_number}
                        onChange={(e) => setFallbackData(prev => ({ ...prev, order_number: e.target.value }))}
                        placeholder="e.g., #1234"
                        className="bg-gray-800 border-gray-600 text-white mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="fallback-message" className="text-gray-300 text-sm">Message</Label>
                      <Textarea
                        id="fallback-message"
                        value={fallbackData.message}
                        onChange={(e) => setFallbackData(prev => ({ ...prev, message: e.target.value }))}
                        required
                        rows={4}
                        className="bg-gray-800 border-gray-600 text-white mt-1 resize-none"
                        placeholder="Describe your question or concern..."
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        disabled={submittingFallback}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        {submittingFallback ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Send className="h-4 w-4 mr-2" />
                        )}
                        Send Message
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowFallbackForm(false)}
                        className="border-gray-600 text-gray-300 hover:bg-gray-700"
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </CardContent>

        <div className="p-3 bg-gray-900 border-t border-gray-700 rounded-b-lg">
          <div className="flex items-center gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="Ask me anything about our services..."
              disabled={loading}
              className="bg-gray-800 border-gray-700 text-white flex-1 focus-visible:ring-blue-500"
            />
            <Button
              onClick={handleSendMessage}
              disabled={loading || !input.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            💡 Tip: Ask about services, pricing, booking process, or policies
          </p>
        </div>
      </Card>
    </div>
  );
};
