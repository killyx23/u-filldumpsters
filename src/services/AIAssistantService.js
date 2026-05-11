
import { supabase } from '@/lib/customSupabaseClient';

/**
 * AI Assistant Service
 * Provides FAQ knowledge base retrieval and simple keyword matching
 * Now integrated with AI Knowledge Base
 */

// Stop words to ignore during matching
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'what', 'when', 'where', 'why', 'how',
  'i', 'you', 'we', 'they', 'he', 'she', 'it', 'my', 'your', 'our', 'their'
]);

/**
 * Tokenize and normalize text
 */
const tokenize = (text) => {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .split(/\s+/)
    .filter(token => token.length > 2 && !STOP_WORDS.has(token));
};

/**
 * Calculate Jaccard similarity between two token sets
 */
const calculateJaccardSimilarity = (tokens1, tokens2) => {
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return union.size === 0 ? 0 : intersection.size / union.size;
};

/**
 * Fetch all FAQs from database
 */
export const fetchFAQs = async () => {
  try {
    const { data, error } = await supabase
      .from('faqs')
      .select('*')
      .order('position', { ascending: true });
    
    if (error) throw error;
    
    console.log('[AIAssistant] Loaded FAQs:', data?.length || 0);
    return data || [];
  } catch (error) {
    console.error('[AIAssistant] Error fetching FAQs:', error);
    throw new Error('Failed to load FAQ knowledge base');
  }
};

/**
 * Fetch all knowledge base entries
 */
export const fetchKnowledgeBase = async () => {
  try {
    const { data, error } = await supabase
      .from('ai_knowledge_base')
      .select(`
        *,
        section:ai_knowledge_sections(id, name, description)
      `);
    
    if (error) throw error;
    
    console.log('[AIAssistant] Loaded Knowledge Base entries:', data?.length || 0);
    return data || [];
  } catch (error) {
    console.error('[AIAssistant] Error fetching knowledge base:', error);
    return [];
  }
};

/**
 * Find the most relevant entry from knowledge base OR FAQs
 * Returns { entry, confidence, source } where source is 'knowledge_base' or 'faq'
 */
export const findRelevantAnswer = async (question, knowledgeBase = null, faqs = null) => {
  if (!question) {
    return { entry: null, confidence: 0, source: null };
  }

  const questionTokens = tokenize(question);
  
  if (questionTokens.length === 0) {
    return { entry: null, confidence: 0, source: null };
  }

  let bestMatch = { entry: null, score: 0, source: null };

  // First, try to find match in Knowledge Base
  if (!knowledgeBase) {
    knowledgeBase = await fetchKnowledgeBase();
  }

  if (knowledgeBase && knowledgeBase.length > 0) {
    const kbScored = knowledgeBase.map(entry => {
      const titleTokens = tokenize(entry.title);
      const contentTokens = tokenize(entry.content);
      
      // Calculate similarity with title (weighted higher)
      const titleSimilarity = calculateJaccardSimilarity(questionTokens, titleTokens);
      
      // Calculate similarity with content (weighted lower)
      const contentSimilarity = calculateJaccardSimilarity(questionTokens, contentTokens);
      
      // Combined score: 70% title match, 30% content match
      const score = (titleSimilarity * 0.7) + (contentSimilarity * 0.3);
      
      return { entry, score, source: 'knowledge_base' };
    });

    const kbBest = kbScored.reduce((best, current) => {
      return current.score > best.score ? current : best;
    }, kbScored[0]);

    if (kbBest.score > bestMatch.score) {
      bestMatch = kbBest;
    }

    console.log('[AIAssistant] Best Knowledge Base match:', {
      title: kbBest.entry?.title,
      confidence: kbBest.score.toFixed(2)
    });
  }

  // If knowledge base match is weak, try FAQs as fallback
  if (bestMatch.score < 0.6) {
    if (!faqs) {
      faqs = await fetchFAQs();
    }

    if (faqs && faqs.length > 0) {
      const faqScored = faqs.map(faq => {
        const faqQuestionTokens = tokenize(faq.question);
        const faqAnswerTokens = tokenize(faq.answer);
        
        const questionSimilarity = calculateJaccardSimilarity(questionTokens, faqQuestionTokens);
        const answerSimilarity = calculateJaccardSimilarity(questionTokens, faqAnswerTokens);
        
        const score = (questionSimilarity * 0.7) + (answerSimilarity * 0.3);
        
        return { entry: faq, score, source: 'faq' };
      });

      const faqBest = faqScored.reduce((best, current) => {
        return current.score > best.score ? current : best;
      }, faqScored[0]);

      if (faqBest.score > bestMatch.score) {
        bestMatch = faqBest;
      }

      console.log('[AIAssistant] Best FAQ match:', {
        question: faqBest.entry?.question,
        confidence: faqBest.score.toFixed(2)
      });
    }
  }

  return {
    entry: bestMatch.entry,
    confidence: bestMatch.score,
    source: bestMatch.source
  };
};

/**
 * DEPRECATED: Use findRelevantAnswer instead
 * Kept for backward compatibility
 */
export const findRelevantFAQ = (question, faqs) => {
  if (!question || !faqs || faqs.length === 0) {
    return { faq: null, confidence: 0 };
  }

  const questionTokens = tokenize(question);
  
  if (questionTokens.length === 0) {
    return { faq: null, confidence: 0 };
  }

  const scored = faqs.map(faq => {
    const faqQuestionTokens = tokenize(faq.question);
    const faqAnswerTokens = tokenize(faq.answer);
    
    const questionSimilarity = calculateJaccardSimilarity(questionTokens, faqQuestionTokens);
    const answerSimilarity = calculateJaccardSimilarity(questionTokens, faqAnswerTokens);
    
    const score = (questionSimilarity * 0.7) + (answerSimilarity * 0.3);
    
    return { faq, score };
  });

  const bestMatch = scored.reduce((best, current) => {
    return current.score > best.score ? current : best;
  }, scored[0]);

  return {
    faq: bestMatch.faq,
    confidence: bestMatch.score
  };
};

/**
 * Submit a fallback message when AI confidence is low
 */
export const submitFallbackMessage = async (messageData) => {
  try {
    const { data, error } = await supabase
      .from('ai_assistant_messages')
      .insert([{
        customer_id: messageData.customer_id,
        name: messageData.name,
        email: messageData.email,
        order_number: messageData.order_number || null,
        message: messageData.message
      }])
      .select()
      .single();
    
    if (error) throw error;
    
    console.log('[AIAssistant] Fallback message submitted:', data.id);
    return data;
  } catch (error) {
    console.error('[AIAssistant] Error submitting fallback message:', error);
    throw new Error('Failed to submit message');
  }
};

/**
 * Determine if confidence is high enough to show answer
 * Threshold: 0.6 (60% similarity)
 */
export const shouldShowFAQAnswer = (confidence) => {
  const CONFIDENCE_THRESHOLD = 0.6;
  return confidence >= CONFIDENCE_THRESHOLD;
};

/**
 * Fetch business hours from settings
 */
export const fetchBusinessHours = async () => {
  try {
    const { data, error } = await supabase
      .from('business_settings')
      .select('setting_value')
      .eq('setting_key', 'business_hours')
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    
    return data?.setting_value || null;
  } catch (error) {
    console.error('[AIAssistant] Error fetching business hours:', error);
    return null;
  }
};

/**
 * Check if current time is within business hours
 */
export const isWithinBusinessHours = (businessHours) => {
  if (!businessHours) return false;
  
  const now = new Date();
  const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][now.getDay()];
  const currentTime = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  
  const todayHours = businessHours[dayOfWeek];
  
  if (!todayHours || !todayHours.open || !todayHours.close) {
    return false; // Closed today
  }
  
  return currentTime >= todayHours.open && currentTime <= todayHours.close;
};
