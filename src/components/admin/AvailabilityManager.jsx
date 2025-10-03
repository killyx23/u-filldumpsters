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

const DateSpecificEditor = ({ date, services, existingRule, onSave, onCancel, weeklyRules, clipboard, setClipboard }) => {
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

            const isAvailable = dateRule?.is_available ?? weeklyRule?.is_available ?? true;

            return {
                service_id: service.id,
                is_available: isAvailable,
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
        setRules(prev => prev.map(r => r.service_id === service_id ? { ...r, [field]: value } : r));
    };

    const handleSaveClick = () => {
        const payload = rules.map(rule => ({
            date: format(date, 'yyyy-MM-dd'),
            ...rule,
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
                    const serviceType = service.service_type;
                    const options = timeOptions[service.id] || generateTimeSlotOptions(120);

                    return (
                        <div key={service.id} className="p-4 bg-white/5 rounded-lg">
                            <div className="flex justify-between items-center mb-3">
                                <h4 className="font-bold text-lg text-yellow-400">{service.name}</h4>
                                <div className="flex items-center gap-2">
                                    <Button variant="ghost" size="sm" onClick={() => handleCopy(service.id)}><Copy className="h-4 w-4 mr-2" /> Copy</Button>
                                    <Button variant="ghost" size="sm" onClick={() => handlePaste(service.id)} disabled={!clipboard || clipboard.type !== 'single'}><ClipboardPaste className="h-4 w-4 mr-2" /> Paste</Button>
                                    <Label className={rule.is_available ? 'text-green-400' : 'text-gray-400'}>{rule.is_available ? "Open" : "Closed"}</Label>
                                    <Switch checked={rule.is_available} onCheckedChange={checked => handleRuleChange(service.id, 'is_available', checked)} />
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
                <Button variant="outline" onClick={onCancel}>Cancel</Button>
                <Button onClick={handleSaveClick}><Save className="mr-2 h-4 w-4" /> Save Changes</Button>
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
    const [selectedDate, setSelectedDate] = useState(null);
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [clipboard, setClipboard] = useState(null);
    const [pasteDates, setPasteDates] = useState([]);
    const [isPasting, setIsPasting] = useState(false);

    const isPasteMode = clipboard?.type === 'all';
    
    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [servicesRes, weeklyRes, dateSpecificRes, globalUnavailRes] = await Promise.all([
                supabase.from('services').select('*').order('id'),
                supabase.from('service_availability').select('*'),
                supabase.from('date_specific_availability').select('*'),
                supabase.from('unavailable_dates').select('*').is('service_id', null),
            ]);

            if (servicesRes.error) throw servicesRes.error;
            setServices(servicesRes.data);

            if (weeklyRes.error) throw weeklyRes.error;
            setWeeklyRules(weeklyRes.data);

            if (dateSpecificRes.error) throw dateSpecificRes.error;
            setDateSpecificRules(dateSpecificRes.data);
            
            if (globalUnavailRes.error) throw globalUnavailRes.error;
            setGlobalUnavailable(globalUnavailRes.data.map(d => parseISO(d.date)));

        } catch (error) {
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
        const { error } = await supabase.from('date_specific_availability').upsert(payload, { onConflict: 'date, service_id' });
        if (error) {
            toast({ title: 'Failed to save date-specific rules', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Date-specific rules saved!' });
            setIsEditorOpen(false);
            setSelectedDate(null);
            fetchData();
        }
    };

    const handleBulkPaste = async () => {
        if (!isPasteMode || pasteDates.length === 0) return;
        setIsPasting(true);

        const payload = pasteDates.flatMap(date => 
            clipboard.data.map(rule => ({
                date: format(date, 'yyyy-MM-dd'),
                ...rule,
            }))
        );

        const { error } = await supabase.from('date_specific_availability').upsert(payload, { onConflict: 'date, service_id' });
        
        if (error) {
            toast({ title: 'Failed to paste settings', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: `Settings applied to ${pasteDates.length} dates!` });
            setClipboard(null);
            setPasteDates([]);
            fetchData();
        }
        setIsPasting(false);
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
                    <h3 className="font-bold text-yellow-300">New Availability Manager</h3>
                    <p className="text-sm text-yellow-200">
                        {isPasteMode 
                            ? `PASTE MODE: Select dates on the calendar to apply the copied schedule. Click "Paste to Selected Days" when done.`
                            : `Click a date to edit its specific hours. Use "Copy All" inside the editor to enter paste mode.`
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
                    />
                </Dialog>
            )}
        </div>
    );
};