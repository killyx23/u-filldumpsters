
import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { Loader2, MessageSquare, CheckCircle, Clock, Send, Mail, User, Hash } from 'lucide-react';
import { format, parseISO } from 'date-fns';

export const AIAssistantMessagesManager = () => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [responseText, setResponseText] = useState('');
  const [updating, setUpdating] = useState(false);
  const [activeTab, setActiveTab] = useState('pending');

  const fetchMessages = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('ai_assistant_messages')
        .select(`
          *,
          customer:customers(id, name, first_name, last_name, email, phone)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setMessages(data || []);
    } catch (error) {
      console.error('[AIAssistantMessagesManager] Error fetching messages:', error);
      toast({
        title: 'Failed to load messages',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();

    // Set up realtime subscription
    const channel = supabase
      .channel('ai-assistant-messages-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'ai_assistant_messages'
      }, () => {
        fetchMessages();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleMarkAsReviewed = async (messageId, notes) => {
    setUpdating(true);
    try {
      const { error } = await supabase
        .from('ai_assistant_messages')
        .update({
          status: 'reviewed',
          admin_notes: notes,
          responded_at: new Date().toISOString()
        })
        .eq('id', messageId);

      if (error) throw error;

      toast({
        title: 'Message updated',
        description: 'Message marked as reviewed'
      });

      fetchMessages();
      setSelectedMessage(null);
      setAdminNotes('');
    } catch (error) {
      toast({
        title: 'Failed to update message',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleSendResponse = async (message) => {
    if (!responseText.trim()) return;

    setUpdating(true);
    try {
      // Create customer note with response
      const { error: noteError } = await supabase
        .from('customer_notes')
        .insert({
          customer_id: message.customer_id,
          source: 'AI Assistant Response',
          content: `**Re: ${message.message.substring(0, 50)}...**\n\n${responseText}`,
          author_type: 'admin'
        });

      if (noteError) throw noteError;

      // Mark message as reviewed
      await handleMarkAsReviewed(message.id, `Responded with: ${responseText.substring(0, 100)}...`);

      setResponseText('');
      
      toast({
        title: 'Response sent',
        description: 'Your response has been sent to the customer'
      });
    } catch (error) {
      toast({
        title: 'Failed to send response',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setUpdating(false);
    }
  };

  const pendingMessages = messages.filter(m => m.status === 'pending');
  const reviewedMessages = messages.filter(m => m.status === 'reviewed');

  const MessageCard = ({ message }) => (
    <Card className="bg-white/5 border-white/10 hover:bg-white/10 transition-colors cursor-pointer" onClick={() => setSelectedMessage(message)}>
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-blue-400" />
            <span className="font-semibold text-white">{message.name}</span>
          </div>
          <Badge variant={message.status === 'pending' ? 'default' : 'secondary'} className={message.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50' : 'bg-green-500/20 text-green-400 border-green-500/50'}>
            {message.status === 'pending' ? (
              <><Clock className="h-3 w-3 mr-1" /> Pending</>
            ) : (
              <><CheckCircle className="h-3 w-3 mr-1" /> Reviewed</>
            )}
          </Badge>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-gray-400">
            <Mail className="h-3 w-3" />
            <span>{message.email}</span>
          </div>
          {message.order_number && (
            <div className="flex items-center gap-2 text-gray-400">
              <Hash className="h-3 w-3" />
              <span>Order: {message.order_number}</span>
            </div>
          )}
        </div>

        <p className="mt-3 text-sm text-gray-300 line-clamp-2">{message.message}</p>

        <div className="mt-3 flex justify-between items-center text-xs text-gray-500">
          <span>{format(parseISO(message.created_at), 'MMM dd, yyyy h:mm a')}</span>
          {message.responded_at && (
            <span className="text-green-400">Responded {format(parseISO(message.responded_at), 'MMM dd')}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="h-12 w-12 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-white mb-2">AI Assistant Messages</h2>
        <p className="text-gray-400">Manage fallback messages from the AI Assistant</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-gray-800">
          <TabsTrigger value="pending" className="data-[state=active]:bg-yellow-500/20 data-[state=active]:text-yellow-400">
            Pending ({pendingMessages.length})
          </TabsTrigger>
          <TabsTrigger value="reviewed" className="data-[state=active]:bg-green-500/20 data-[state=active]:text-green-400">
            Reviewed ({reviewedMessages.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-6 space-y-4">
          {pendingMessages.length === 0 ? (
            <Card className="bg-white/5 border-white/10">
              <CardContent className="p-12 text-center">
                <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-4 opacity-50" />
                <p className="text-gray-400">No pending messages</p>
              </CardContent>
            </Card>
          ) : (
            pendingMessages.map(message => <MessageCard key={message.id} message={message} />)
          )}
        </TabsContent>

        <TabsContent value="reviewed" className="mt-6 space-y-4">
          {reviewedMessages.length === 0 ? (
            <Card className="bg-white/5 border-white/10">
              <CardContent className="p-12 text-center">
                <MessageSquare className="h-12 w-12 text-gray-600 mx-auto mb-4 opacity-50" />
                <p className="text-gray-400">No reviewed messages yet</p>
              </CardContent>
            </Card>
          ) : (
            reviewedMessages.map(message => <MessageCard key={message.id} message={message} />)
          )}
        </TabsContent>
      </Tabs>

      {/* Message Detail Dialog */}
      <Dialog open={!!selectedMessage} onOpenChange={(open) => !open && setSelectedMessage(null)}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedMessage && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl">Message Details</DialogTitle>
                <DialogDescription className="text-gray-400">
                  Submitted {format(parseISO(selectedMessage.created_at), 'MMMM dd, yyyy \'at\' h:mm a')}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Name</p>
                    <p className="text-sm font-medium">{selectedMessage.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Email</p>
                    <p className="text-sm font-medium">{selectedMessage.email}</p>
                  </div>
                  {selectedMessage.order_number && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Order Number</p>
                      <p className="text-sm font-medium">{selectedMessage.order_number}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Status</p>
                    <Badge variant={selectedMessage.status === 'pending' ? 'default' : 'secondary'}>
                      {selectedMessage.status}
                    </Badge>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-gray-400 mb-2">Customer Message</p>
                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                    <p className="text-sm whitespace-pre-wrap">{selectedMessage.message}</p>
                  </div>
                </div>

                {selectedMessage.admin_notes && (
                  <div>
                    <p className="text-xs text-gray-400 mb-2">Admin Notes</p>
                    <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-4">
                      <p className="text-sm whitespace-pre-wrap">{selectedMessage.admin_notes}</p>
                    </div>
                  </div>
                )}

                {selectedMessage.status === 'pending' && (
                  <>
                    <div>
                      <p className="text-xs text-gray-400 mb-2">Send Response</p>
                      <Textarea
                        value={responseText}
                        onChange={(e) => setResponseText(e.target.value)}
                        placeholder="Type your response to the customer..."
                        rows={4}
                        className="bg-gray-800 border-gray-700 text-white resize-none"
                      />
                    </div>

                    <div>
                      <p className="text-xs text-gray-400 mb-2">Admin Notes (Internal)</p>
                      <Textarea
                        value={adminNotes}
                        onChange={(e) => setAdminNotes(e.target.value)}
                        placeholder="Add internal notes (optional)..."
                        rows={3}
                        className="bg-gray-800 border-gray-700 text-white resize-none"
                      />
                    </div>
                  </>
                )}
              </div>

              <DialogFooter className="flex gap-2">
                {selectedMessage.status === 'pending' ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => handleMarkAsReviewed(selectedMessage.id, adminNotes)}
                      disabled={updating}
                      className="border-gray-700 text-gray-300 hover:bg-gray-800"
                    >
                      {updating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                      Mark as Reviewed
                    </Button>
                    <Button
                      onClick={() => handleSendResponse(selectedMessage)}
                      disabled={updating || !responseText.trim()}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {updating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                      Send Response & Mark Reviewed
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" onClick={() => setSelectedMessage(null)} className="border-gray-700 text-gray-300 hover:bg-gray-800">
                    Close
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
