import React, { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/customSupabaseClient';
import { resolveCustomerUploadSignedUrl } from '@/utils/verificationImageHelper';

const photoPathsFromNote = (content = '') => {
  const match = String(content).match(/\*\*PHOTOS:\*\*\s*([^\n]*)/);
  if (!match?.[1]) return [];
  return match[1].split('|').map((path) => path.trim()).filter(Boolean).map((path) => ({ path, name: path.split('/').pop() }));
};

const noteField = (content, label) => {
  const match = String(content).match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]*)`));
  return match?.[1]?.trim() || '';
};

const ClaimPhotos = ({ photos }) => {
  const [urls, setUrls] = useState({});

  const photoKey = photos.map((photo) => photo.path).join('|');

  useEffect(() => {
    let active = true;
    (async () => {
      const next = {};
      for (const photo of photos) {
        next[photo.path] = await resolveCustomerUploadSignedUrl(photo);
      }
      if (active) setUrls(next);
    })();
    return () => {
      active = false;
    };
  }, [photoKey]);

  if (!photos.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {photos.map((photo) => (
        urls[photo.path] ? (
          <a key={photo.path} href={urls[photo.path]} target="_blank" rel="noopener noreferrer">
            <img src={urls[photo.path]} alt={photo.name || 'Claim photo'} className="h-16 w-16 rounded object-cover border border-white/20" />
          </a>
        ) : (
          <span key={photo.path} className="text-xs text-gray-400">{photo.name || 'Photo'}</span>
        )
      ))}
    </div>
  );
};

export const PortalHardwareClaims = ({ customerId, notes = [], active = true, onReviewClaim }) => {
  const [claims, setClaims] = useState([]);
  const [hiddenNoteIds, setHiddenNoteIds] = useState([]);

  useEffect(() => {
    if (!customerId || !active) return undefined;
    let alive = true;
    supabase
      .from('protection_plan_claims')
      .select('id, booking_id, description, status, notice_submitted_at, submitted_via, proof_photos')
      .eq('customer_id', customerId)
      .eq('submitted_via', 'portal')
      .eq('status', 'open')
      .order('notice_submitted_at', { ascending: false })
      .then(({ data }) => {
        if (alive) setClaims(data || []);
      });
    return () => {
      alive = false;
    };
  }, [customerId, active]);

  const unenrolled = (notes || []).filter((note) => (
    note.source === 'Support Ticket'
    && noteField(note.content, 'HPP_CLAIM') === 'not_enrolled'
    && !note.resolved_at
    && !hiddenNoteIds.includes(note.id)
  ));

  const markNoteReviewed = async (noteId) => {
    const { error } = await supabase
      .from('customer_notes')
      .update({ resolved_at: new Date().toISOString() })
      .eq('id', noteId);
    if (!error) setHiddenNoteIds((prev) => [...prev, noteId]);
  };

  if (claims.length === 0 && unenrolled.length === 0) return null;

  return (
    <div className="bg-white/5 p-6 rounded-lg shadow-lg space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-yellow-300 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" /> Hardware damage claims
        </h3>
      </div>
      <p className="text-sm text-gray-300">
        Open a claim to review the photos and finish it on Protection. A finished claim leaves this list.
      </p>
      {claims.map((claim) => {
        const photos = Array.isArray(claim.proof_photos) ? claim.proof_photos : [];
        return (
          <div key={claim.id} className="rounded-md border border-orange-500/30 bg-black/20 p-3 space-y-2 text-sm text-blue-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>Order #{claim.booking_id} · Hardware Protection Plan accepted · Pending</p>
              {onReviewClaim && (
                <Button type="button" size="sm" className="bg-yellow-500 text-black hover:bg-yellow-400" onClick={() => onReviewClaim(claim)}>
                  Review claim
                </Button>
              )}
            </div>
            <p className="text-orange-200">
              Written notice {claim.notice_submitted_at ? format(parseISO(claim.notice_submitted_at), 'PPP p') : 'time not saved'}
            </p>
            {claim.description && <p>{claim.description}</p>}
            <ClaimPhotos photos={photos} />
          </div>
        );
      })}
      {unenrolled.map((note) => (
        <div key={note.id} className="rounded-md border border-amber-500/30 bg-black/20 p-3 space-y-2 text-sm text-blue-100">
          <p>Order #{noteField(note.content, 'BOOKING') || note.booking_id || 'unknown'} · Hardware Protection Plan not on this booking</p>
          <p className="text-amber-200">
            Written notice {noteField(note.content, 'NOTICE_AT') || (note.created_at ? format(parseISO(note.created_at), 'PPP p') : 'time not saved')}
          </p>
          <p>Charge the full damage from the rental. Photos are saved on this ticket.</p>
          <ClaimPhotos photos={photoPathsFromNote(note.content)} />
          <Button type="button" size="sm" variant="outline" className="border-amber-300 text-amber-100" onClick={() => markNoteReviewed(note.id)}>
            Mark reviewed
          </Button>
        </div>
      ))}
    </div>
  );
};
