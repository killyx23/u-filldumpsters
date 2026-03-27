import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Ban, Calendar as CalendarIcon, Save, Settings, AlertTriangle, Copy, ClipboardPaste, CopyCheck, X } from 'lucide-react';
import { format, parseISO, startOfDay, addDays, isSameDay, getDay } from 'date-fns';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { generateTimeSlotOptions } from '@/components/admin/availability/time-helpers';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const TimeRangeSelector = ({ label, startValue, endValue, onStartChange, onEndChange, options }) => (
    <div>
        <Label className="text-blue-200 font-semibold mb-2 block">{label}</Label>
        <div className="grid grid-cols-2 gap-4">
             <select value={startValue || ''} onChange={(e) => onStartChange(e.target.value)} className="bg-gray-800 border border-gray-600 rounded-md px-2 py-1.5 text-sm text-white focus:ring-yellow-500 focus:border-yellow-500 w-full">
                <option value="">Start Time</option>
                {options.map(option => <option key={`start-${label}-${option.value}`} value={option.value}>{option.label}</option>)}
            </select>
            <select value={endValue || ''} onChange={(e) => onEndChange(e.target.value)} className="bg-gray-800 border border-gray-600 rounded-md px-2 py-1.5 text-sm text-white focus:ring-yellow-500 focus:border-yellow-500 w-full">
                <option value="">End Time</option>
                {options.map(option => <option key={`end-${label}-${option.value}`} value={option.value}>{option.label}</option>)}
            </select>
        </div>
    </div>
);

const DateSpecificEditor = ({ date, services, existingRule, onSave, onCancel, weeklyRules, clipboard, setClipboard, isSaving }) => {
    const [rules, setRules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [copiedAll, setCopiedAll] = useState(false);
    
    const timeOptions = {
        1: generateTimeSlotOptions(120), // Service 1: 2 hours
        2: generateTimeSlotOptions(60),  // Service 2: 1 hour
        3: generateTimeSlotOptions(60),  // Service 3: 1 hour
        4: generateTimeSlotOptions(120), // Service 4: 2 hours
    };

    useEffect(() => {
        if (!services || !weeklyRules || !date) {
            setLoading(true);
            return;
        }
        
        const dayOfWeek = getDay(date);

        const initialRules = services.map(service => {
            const dateRule = existingRule?.find(r => r.service_id === service.id);
            const weeklyRule = weeklyRules?.find(wr => wr.service_id === service.id && wr.day_of_week === dayOfWeek);

            // Default to true explicitly if not defined
            const isAvailable = dateRule?.is_available ?? weeklyRule?.is_available ?? true;

            return {
                service_id: service.id,
                is_available: Boolean(isAvailable),
                delivery_start_time: dateRule?.delivery_start_time ?? weeklyRule?.delivery_start_time,
                delivery_end_time: dateRule?.delivery_end_time ?? weeklyRule?.delivery_end_time,
                pickup_start_time: dateRule?.pickup_start_time ?? weeklyRule?.pickup_start_time,
                pickup_end_time: dateRule?.pickup_end_time ?? weeklyRule?.pickup_end_time,
                hourly_start_time: dateRule?.hourly_start_time ?? weeklyRule?.hourly_start_time,
                hourly_end_time: dateRule?.hourly_end_time ?? weeklyRule?.hourly_end_time,
                return_start_time: dateRule?.return_start_time ?? weeklyRule?.return_start_time,
                return_end_time: dateRule?.return_end_time ?? weeklyRule?.return_end_time,
            };
        });
        setRules(initialRules);
        setLoading(false);
    }, [date, services, existingRule, weeklyRules]);

    const handleRuleChange = (service_id, field, value) => {
        setRules(prev => prev.map(r => {
            if (r.service_id === service_id) {
                return { 
                    ...r, 
                    [field]: field === 'is_available' ? Boolean(value) : (value || null) 
                };
            }
            return r;
        }));
    };

    const handleSaveClick = () => {
        const payload = rules.map(rule => ({
            date: format(date, 'yyyy-MM-dd'),
            service_id: rule.service_id,
            is_available: Boolean(rule.is_available),
            delivery_start_time: rule.delivery_start_time,
            delivery_end_time: rule.delivery_end_time,
            pickup_start_time: rule.pickup_start_time,
            pickup_end_time: rule.pickup_end_time,
            hourly_start_time: rule.hourly_start_time,
            hourly_end_time: rule.hourly_end_time,
            return_start_time: rule.return_start_time,
            return_end_time: rule.return_end_time
        }));
        onSave(payload);
    };

    const handleCopy = (service_id) => {
        const ruleToCopy = rules.find(r => r.service_id === service_id);
        if (ruleToCopy) {
            setClipboard({ type: 'single', data: ruleToCopy });
            toast({ title: "Copied!", description: "Service times copied to clipboard." });
        }
    };

    const handlePaste = (service_id) => {
        if (clipboard?.type === 'single') {
            const { data } = clipboard;
            setRules(prev => prev.map(r => r.service_id === service_id ? { ...r, ...data, service_id: r.service_id } : r));
            toast({ title: "Pasted!", description: "Service times have been pasted." });
        } else {
            toast({ title: "Nothing to paste", description: "Copy a single service's times first.", variant: "destructive" });
        }
    };

    const handleCopyAll = () => {
        setClipboard({ type: 'all', data: rules });
        setCopiedAll(true);
        toast({ title: "Copied All!", description: "All service settings for this day have been copied. You can now select multiple dates on the calendar to paste." });
        setTimeout(() => setCopiedAll(false), 2000);
        onCancel();
    };

    const handlePasteAll = () => {
        if (clipboard?.type === 'all') {
            const pastedRules = clipboard.data.map((copiedRule, index) => ({
                ...rules[index],
                ...copiedRule,
                service_id: rules[index].service_id,
            }));
            setRules(pastedRules);
            toast({ title: "Pasted All!", description: "All copied settings have been applied." });
        } else {
            toast({ title: "Nothing to paste", description: "Use 'Copy All' on another day first.", variant: "destructive" });
        }
    };

    return (
        <DialogContent className="bg-gray-900 text-white border-yellow-400 max-w-4xl">
            <DialogHeader>
                <DialogTitle>Edit Availability for {date ? format(date, 'PPP') : '...'}</DialogTitle>
                <DialogDescription>
                    Use 'Copy All' to enter paste-mode on the calendar, or copy/paste individual service times below.
                </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 my-4 p-3 bg-gray-800 rounded-lg">
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="sm" onClick={handleCopyAll}>
                                {copiedAll ? <CopyCheck className="h-4 w-4 mr-2 text-green-400" /> : <Copy className="h-4 w-4 mr-2" />}
                                Copy All & Close
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Copy all settings and enter multi-day paste mode.</p>
                        </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="sm" onClick={handlePasteAll} disabled={!clipboard || clipboard.type !== 'all'}>
                                <ClipboardPaste className="h-4 w-4 mr-2" />
                                Paste All
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Paste settings copied from another day.</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
            <div className="py-4 space-y-6 max-h-[60vh] overflow-y-auto pr-2">
                {loading && <div className="flex justify-center items-center h-40"><Loader2 className="h-8 w-8 animate-spin text-yellow-400" /> <span className="ml-2">Loading services...</span></div>}

                {!loading && services && services.length > 0 ? services.map(service => {
                    const rule = rules.find(r => r.service_id === service.id);
                    if (!rule) return null;
                    const options = timeOptions[service.id] || generateTimeSlotOptions(120);

                    return (
                        <div key={service.id} className="p-4 bg-white/5 rounded-lg">
                            <div className="flex justify-between items-center mb-3">
                                <h4 className="font-bold text-lg text-yellow-400">{service.name}</h4>
                                <div className="flex items-center gap-2">
                                    <Button variant="ghost" size="sm" onClick={() => handleCopy(service.id)}><Copy className="h-4 w-4 mr-2" /> Copy</Button>
                                    <Button variant="ghost" size="sm" onClick={() => handlePaste(service.id)} disabled={!clipboard || clipboard.type !== 'single'}><ClipboardPaste className="h-4 w-4 mr-2" /> Paste</Button>
                                    <Label className={!rule.is_available ? 'text-red-400 font-bold' : 'text-gray-400'}>Closed</Label>
                                    <Switch 
                                        checked={!rule.is_available} 
                                        onCheckedChange={checked => handleRuleChange(service.id, 'is_available', !checked)} 
                                    />
                                </div>
                            </div>
                            {rule.is_available && (
                                <div className="space-y-4 pt-3 border-t border-white/10">
                                    {service.id === 1 || service.id === 4 ? ( // Dumpster or Delivery Trailer
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <TimeRangeSelector label="Delivery" startValue={rule.delivery_start_time} endValue={rule.delivery_end_time} onStartChange={v => handleRuleChange(service.id, 'delivery_start_time', v)} onEndChange={v => handleRuleChange(service.id, 'delivery_end_time', v)} options={options} />
                                            <TimeRangeSelector label="Pickup" startValue={rule.pickup_start_time} endValue={rule.pickup_end_time} onStartChange={v => handleRuleChange(service.id, 'pickup_start_time', v)} onEndChange={v => handleRuleChange(service.id, 'pickup_end_time', v)} options={options} />
                                        </div>
                                    ) : service.id === 2 ? ( // Hourly Trailer
                                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <TimeRangeSelector label="Pickup" startValue={rule.hourly_start_time} endValue={rule.hourly_end_time} onStartChange={v => handleRuleChange(service.id, 'hourly_start_time', v)} onEndChange={v => handleRuleChange(service.id, 'hourly_end_time', v)} options={options} />
                                            <TimeRangeSelector label="Return" startValue={rule.return_start_time} endValue={rule.return_end_time} onStartChange={v => handleRuleChange(service.id, 'return_start_time', v)} onEndChange={v => handleRuleChange(service.id, 'return_end_time', v)} options={options} />
                                        </div>
                                    ) : service.id === 3 ? ( // Material Delivery
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <TimeRangeSelector label="Delivery" startValue={rule.delivery_start_time} endValue={rule.delivery_end_time} onStartChange={v => handleRuleChange(service.id, 'delivery_start_time', v)} onEndChange={v => handleRuleChange(service.id, 'delivery_end_time', v)} options={options} />
                                        </div>
                                    ) : null}
                                </div>
                            )}
                        </div>
                    );
                }) : !loading && <p>Could not load services. Please try again.</p>}
            </div>
            <DialogFooter className="mt-4">
                <Button variant="outline" onClick={onCancel} disabled={isSaving}>Cancel</Button>
                <Button onClick={handleSaveClick} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save Changes
                </Button>
            </DialogFooter>
        </DialogContent>
    );
};

export const AvailabilityManager = () => {
    const [services, setServices] = useState([]);
    const [weeklyRules, setWeeklyRules] = useState([]);
    const [dateSpecificRules, setDateSpecificRules] = useState([]);
    const [globalUnavailable, setGlobalUnavailable] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [selectedDate, setSelectedDate] = useState(null);
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [clipboard, setClipboard] = useState(null);
    const [pasteDates, setPasteDates] = useState([]);
    const [isPasting, setIsPasting] = useState(false);

    const isPasteMode = clipboard?.type === 'all';
    
    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [servicesRes, weeklyRes, dateSpecificRes] = await Promise.all([
                supabase.from('services').select('*').order('id'),
                supabase.from('service_availability').select('*'),
                supabase.from('date_specific_availability').select('*'),
            ]);

            if (servicesRes.error) throw servicesRes.error;
            setServices(servicesRes.data);

            if (weeklyRes.error) throw weeklyRes.error;
            setWeeklyRules(weeklyRes.data);

            if (dateSpecificRes.error) throw dateSpecificRes.error;
            setDateSpecificRules(dateSpecificRes.data);
            
            // Calculate global unavailable dates (dates where ALL services are is_available: false)
            const dateMap = {};
            dateSpecificRes.data.forEach(rule => {
                if (!dateMap[rule.date]) dateMap[rule.date] = [];
                dateMap[rule.date].push(rule);
            });
            
            const completelyUnavailableDates = Object.keys(dateMap)
                .filter(date => {
                    const rulesForDate = dateMap[date];
                    return rulesForDate.length === servicesRes.data.length && rulesForDate.every(r => r.is_available === false);
                })
                .map(d => parseISO(d));
                
            setGlobalUnavailable(completelyUnavailableDates);

        } catch (error) {
            console.error("Error fetching availability data:", error);
            toast({ title: 'Error fetching data', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleDateSelect = (date) => {
        if (!date) return;

        if (isPasteMode) {
            const newPasteDates = pasteDates.some(d => isSameDay(d, date))
                ? pasteDates.filter(d => !isSameDay(d, date))
                : [...pasteDates, date];
            setPasteDates(newPasteDates);
        } else {
            setSelectedDate(date);
            setIsEditorOpen(true);
        }
    };

    const handleSaveDateSpecific = async (payload) => {
        setIsSaving(true);
        try {
            // Ensure payload always sends clean boolean for is_available
            const cleanPayload = payload.map(p => ({
                ...p,
                is_available: Boolean(p.is_available)
            }));
            
            const { error } = await supabase.from('date_specific_availability').upsert(cleanPayload, { onConflict: 'date, service_id' });
            
            if (error) throw error;
            
            toast({ title: 'Availability updated!', description: "The changes have been saved successfully." });
            setIsEditorOpen(false);
            setSelectedDate(null);
            fetchData();
        } catch (error) {
            console.error("Upsert error:", error);
            toast({ title: 'Failed to save availability', description: error.message || 'An unexpected error occurred.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleBulkPaste = async () => {
        if (!isPasteMode || pasteDates.length === 0) return;
        setIsPasting(true);

        const payload = pasteDates.flatMap(date => 
            clipboard.data.map(rule => ({
                date: format(date, 'yyyy-MM-dd'),
                service_id: rule.service_id,
                is_available: Boolean(rule.is_available),
                delivery_start_time: rule.delivery_start_time,
                delivery_end_time: rule.delivery_end_time,
                pickup_start_time: rule.pickup_start_time,
                pickup_end_time: rule.pickup_end_time,
                hourly_start_time: rule.hourly_start_time,
                hourly_end_time: rule.hourly_end_time,
                return_start_time: rule.return_start_time,
                return_end_time: rule.return_end_time
            }))
        );

        try {
            const { error } = await supabase.from('date_specific_availability').upsert(payload, { onConflict: 'date, service_id' });
            
            if (error) throw error;
            
            toast({ title: `Settings applied to ${pasteDates.length} dates!`, description: "Bulk update successful." });
            setClipboard(null);
            setPasteDates([]);
            fetchData();
        } catch (error) {
            console.error("Bulk upsert error:", error);
            toast({ title: 'Failed to paste settings', description: error.message || 'Unknown error', variant: 'destructive' });
        } finally {
            setIsPasting(false);
        }
    };

    const cancelPasteMode = () => {
        setClipboard(null);
        setPasteDates([]);
    };

    if (loading) return <div className="flex justify-center items-center h-64"><Loader2 className="h-16 w-16 animate-spin text-yellow-400" /></div>;

    return (
        <div className="space-y-6">
            <div className="bg-yellow-900/20 border border-yellow-700 p-4 rounded-lg flex items-start gap-4">
                <AlertTriangle className="h-8 w-8 text-yellow-400 mt-1" />
                <div>
                    <h3 className="font-bold text-yellow-300">Date Specific Availability Manager</h3>
                    <p className="text-sm text-yellow-200">
                        {isPasteMode 
                            ? `PASTE MODE: Select dates on the calendar to apply the copied schedule. Click "Paste to Selected Days" when done.`
                            : `Click a date to edit its specific hours or toggle unavailability. Use "Copy All" inside the editor to enter paste mode.`
                        }
                    </p>
                </div>
            </div>

            {isPasteMode && (
                <div className="p-4 bg-blue-900/50 rounded-lg flex items-center justify-center gap-4">
                    <Button onClick={handleBulkPaste} disabled={pasteDates.length === 0 || isPasting}>
                        {isPasting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ClipboardPaste className="h-4 w-4 mr-2" />}
                        Paste to {pasteDates.length} Selected Day(s)
                    </Button>
                    <Button variant="destructive" onClick={cancelPasteMode}>
                        <X className="h-4 w-4 mr-2" />
                        Cancel Paste Mode
                    </Button>
                </div>
            )}

            <div className="bg-white/10 p-6 rounded-2xl">
                 <Calendar
                    mode={isPasteMode ? "multiple" : "single"}
                    selected={isPasteMode ? pasteDates : selectedDate}
                    onSelect={isPasteMode ? setPasteDates : handleDateSelect}
                    className="p-0"
                    numberOfMonths={1}
                    disabled={{ before: startOfDay(new Date()) }}
                    modifiers={{
                        unavailable: globalUnavailable,
                        hasRule: dateSpecificRules.map(r => parseISO(r.date))
                    }}
                    modifiersClassNames={{
                        unavailable: 'day-unavailable',
                        hasRule: 'day-has-rule'
                    }}
                 />
            </div>
            {isEditorOpen && selectedDate && (
                <Dialog open={isEditorOpen} onOpenChange={(isOpen) => {
                    if (!isOpen) {
                      setIsEditorOpen(false);
                      setSelectedDate(null);
                    }
                }}>
                    <DateSpecificEditor 
                        date={selectedDate}
                        services={services}
                        existingRule={dateSpecificRules.filter(r => isSameDay(parseISO(r.date), selectedDate))}
                        weeklyRules={weeklyRules}
                        onSave={handleSaveDateSpecific}
                        onCancel={() => {
                            setIsEditorOpen(false);
                            setSelectedDate(null);
                        }}
                        clipboard={clipboard}
                        setClipboard={setClipboard}
                        isSaving={isSaving}
                    />
                </Dialog>
            )}
        </div>
    );
};