import {
  AlertCircle,
  Info,
  MapPin,
  Calendar,
  Clock,
  Truck,
  RotateCcw,
  ChevronDown,
  ShieldCheck,
  UploadCloud,
  Mail,
  Lock,
  CreditCard,
  CheckSquare,
  Plus,
  Minus,
  List,
  RefreshCw,
  ArrowRight,
  Tag,
} from 'lucide-react';

const entry = (props) => ({ visible: true, ...props });

export function getBookingGuideEntries(stepKey, context = {}) {
  const { planId, isDelivery } = context;

  switch (stepKey) {
    case 'details':
      return [
        entry({
          id: 'alert-restrictions',
          icon: AlertCircle,
          iconClassName: 'text-yellow-500 animate-pulse',
          shortLabel: 'Pulsing warning icon',
          summary: 'Important restrictions',
          description:
            'Opens details about rental liability, prohibited materials, or towing requirements for your selected service.',
          howToUse: 'Tap the pulsing yellow icon next to the service name to read the full notice before you continue.',
          visible: (planId === 2 && !isDelivery) || planId === 4,
        }),
        entry({
          id: 'see-more',
          icon: ChevronDown,
          iconClassName: 'text-blue-400',
          shortLabel: 'See more / see less',
          summary: 'Expand service terms',
          description: 'Shows or hides extra service terms such as site access, permits, and rental policies.',
          howToUse: 'Tap “see more” under Service Terms to expand. Tap “see less” to collapse.',
          visible: planId === 4,
        }),
        entry({
          id: 'returning-customer',
          icon: RotateCcw,
          iconClassName: 'text-blue-400',
          shortLabel: 'Returning Customer?',
          summary: 'Sign in to pre-fill',
          description: 'Lets you verify your email and pull information from a previous booking.',
          howToUse: 'Tap “Returning Customer?” above the address fields and follow the sign-in steps.',
        }),
        entry({
          id: 'delivery-checkbox',
          icon: Truck,
          iconClassName: 'text-yellow-400',
          shortLabel: 'Delivery option',
          summary: 'Need delivery instead of pickup',
          description: 'Switches this rental to our delivery service with drop-off and pickup at your address.',
          howToUse: 'Check the delivery box if you do not have a truck. An info icon may appear for pricing details.',
          visible: planId === 2,
        }),
        entry({
          id: 'address-autocomplete',
          icon: MapPin,
          iconClassName: 'text-red-400',
          shortLabel: 'Address search',
          summary: 'Find your address',
          description: 'Start typing to search. Selecting a suggestion helps verify your location for pricing.',
          howToUse: 'Type your street address and pick a match from the list. You can still edit city, state, and ZIP.',
        }),
        entry({
          id: 'date-time',
          icon: Calendar,
          iconClassName: 'text-blue-300',
          shortLabel: 'Dates & times',
          summary: 'Schedule your rental',
          description: 'Choose pickup/delivery dates and available time windows for your rental period.',
          howToUse: 'Tap the calendar button to pick a date, then choose a time from the dropdown where shown.',
        }),
        entry({
          id: 'mileage-note',
          icon: Truck,
          iconClassName: 'text-yellow-300',
          shortLabel: 'Mileage note',
          summary: 'Distance-based fees',
          description: 'Delivery mileage is calculated in a later step based on your address.',
          howToUse: 'Read the note under the price estimate. No action needed until the add-ons step.',
          visible: isDelivery || planId === 1,
        }),
      ].filter((e) => e.visible !== false);

    case 'addons':
      return [
        entry({
          id: 'info-category',
          icon: Info,
          iconClassName: 'text-yellow-400',
          shortLabel: 'Info (ⓘ) on price lines',
          summary: 'Category details',
          description: 'Explains what a charge covers—insurance, protection, equipment, or fees.',
          howToUse: 'Tap the small yellow info icon next to a category title in your order summary.',
        }),
        entry({
          id: 'disposal-info',
          icon: Info,
          iconClassName: 'text-blue-400',
          shortLabel: 'Disposal info',
          summary: 'Special disposal items',
          description: 'Lists fees and rules for mattresses, TVs, appliances, and similar items.',
          howToUse: 'Tap the info button in the disposal section before adding quantities.',
        }),
        entry({
          id: 'quantity',
          icon: Plus,
          iconClassName: 'text-white',
          shortLabel: '+ / − quantity',
          summary: 'Add or remove items',
          description: 'Increases or decreases equipment or disposal item counts in your order.',
          howToUse: 'Use + and − buttons next to each item. Totals update automatically.',
        }),
        entry({
          id: 'coupon',
          icon: Tag,
          iconClassName: 'text-green-400',
          shortLabel: 'Coupon code',
          summary: 'Apply a discount',
          description: 'Enter a valid promo code in the order summary to reduce your total.',
          howToUse: 'Type your code in the coupon field and apply before proceeding.',
        }),
      ];

    case 'review':
      return [
        entry({
          id: 'info-pricing',
          icon: Info,
          iconClassName: 'text-yellow-400',
          shortLabel: 'Info on charges',
          summary: 'Charge explanations',
          description: 'Tap info icons beside line items to understand insurance, fees, and add-ons.',
          howToUse: 'Review each section and tap any ⓘ icon for a full explanation.',
        }),
        entry({
          id: 'continue-review',
          icon: ArrowRight,
          iconClassName: 'text-yellow-400',
          shortLabel: 'Continue button',
          summary: 'Move to contact info',
          description: 'Confirms you have reviewed your selections and pricing before entering contact details.',
          howToUse: 'Tap “Continue to Contact Info” when your summary looks correct.',
        }),
      ];

    case 'contact':
      return [
        entry({
          id: 'returning-hint',
          icon: RotateCcw,
          iconClassName: 'text-blue-400',
          shortLabel: 'Returning customer',
          summary: 'Already booked with us',
          description: 'If you skipped sign-in earlier, use Returning Customer on the booking form to pre-fill faster next time.',
          howToUse: 'Complete this form manually, or go back to use Returning Customer on step 1.',
        }),
        entry({
          id: 'phone',
          icon: Info,
          iconClassName: 'text-blue-300',
          shortLabel: 'Phone validation',
          summary: '10-digit phone',
          description: 'We need a valid phone number for delivery updates and rental communication.',
          howToUse: 'Enter a 10-digit US phone number. Fix any warning before continuing.',
        }),
        entry({
          id: 'address-fields',
          icon: MapPin,
          iconClassName: 'text-red-400',
          shortLabel: 'Contact address',
          summary: 'Billing / contact address',
          description: 'Should match the person responsible for the rental and payment.',
          howToUse: 'Fill in all address fields. Use the autocomplete on step 1 when possible.',
        }),
      ];

    case 'terms':
      return [
        entry({
          id: 'expand-section',
          icon: ChevronDown,
          iconClassName: 'text-blue-400',
          shortLabel: 'Expand a section',
          summary: 'Read full terms',
          description: 'Each policy section can be expanded to read the complete text.',
          howToUse: 'Tap a section title to expand or collapse. Check the box when you agree.',
        }),
        entry({
          id: 'accept-all',
          icon: CheckSquare,
          iconClassName: 'text-yellow-400',
          shortLabel: 'Accept All & Continue',
          summary: 'Required agreements',
          description: 'You must accept every section before the button becomes active.',
          howToUse: 'Expand and accept each section, then tap Accept All & Continue.',
        }),
      ];

    case 'agreement':
      return [
        entry({
          id: 'scroll-read',
          icon: Info,
          iconClassName: 'text-blue-300',
          shortLabel: 'Rental agreement',
          summary: 'Read before signing',
          description: 'The full agreement must be reviewed. Fields may include initials or signature.',
          howToUse: 'Scroll through the document, complete required fields, then tap Agree & Continue.',
        }),
        entry({
          id: 'agree-button',
          icon: ShieldCheck,
          iconClassName: 'text-green-400',
          shortLabel: 'Agree & Continue',
          summary: 'Confirm acceptance',
          description: 'Submits your agreement and moves you to the next booking step.',
          howToUse: 'Only tap when all required agreement fields are complete.',
        }),
      ];

    case 'verification':
      return [
        entry({
          id: 'upload',
          icon: UploadCloud,
          iconClassName: 'text-blue-300',
          shortLabel: 'Upload license',
          summary: 'Driver verification',
          description: 'Upload front and back of the driver’s license, your auto insurance declaration page or card, and enter the towing vehicle plate.',
          howToUse: 'Tap Upload Front/Back and Upload Insurance Document, then fill in the license plate field.',
        }),
        entry({
          id: 'skip',
          icon: AlertCircle,
          iconClassName: 'text-orange-400',
          shortLabel: 'Continue without Info',
          summary: 'Skip with reason',
          description: 'If you cannot upload now, explain why. Your booking may require customer service review before confirmation.',
          howToUse: 'Enter a reason in the box, then tap Continue without Info.',
        }),
        entry({
          id: 'submit-verification',
          icon: ShieldCheck,
          iconClassName: 'text-green-400',
          shortLabel: 'Submit & Continue',
          summary: 'Complete verification',
          description: 'Use when all required license, insurance, and plate information is provided.',
          howToUse: 'Tap when uploads and plate are complete. You must certify the information is accurate before continuing to payment.',
        }),
      ];

    case 'email':
      return [
        entry({
          id: 'verify-code',
          icon: Mail,
          iconClassName: 'text-yellow-400',
          shortLabel: 'Verification code',
          summary: 'Check your email',
          description: 'We send a one-time code to confirm your email before payment.',
          howToUse: 'Enter the code from your email and tap Verify & Continue to Payment.',
        }),
        entry({
          id: 'resend',
          icon: RefreshCw,
          iconClassName: 'text-blue-300',
          shortLabel: 'Resend code',
          summary: 'Didn’t get the email',
          description: 'Request a new code if the first one expired or did not arrive.',
          howToUse: 'Tap “Didn’t receive a code? Resend” and check spam folders.',
        }),
      ];

    case 'payment':
      return [
        entry({
          id: 'confirm-details',
          icon: CheckSquare,
          iconClassName: 'text-green-400',
          shortLabel: 'Confirm details',
          summary: 'Required checkbox',
          description: 'Confirms your order summary and contact information are correct before charging.',
          howToUse: 'Check the box after reviewing the summary above the payment form.',
        }),
        entry({
          id: 'map-verify',
          icon: MapPin,
          iconClassName: 'text-orange-400',
          shortLabel: 'Delivery map',
          summary: 'Verify drop-off location',
          description: 'For delivery rentals, confirm the pin matches where equipment should go.',
          howToUse: 'Review the map and confirm the location before paying.',
          visible: context.isDeliveryService,
        }),
        entry({
          id: 'pay',
          icon: CreditCard,
          iconClassName: 'text-green-400',
          shortLabel: 'Pay button',
          summary: 'Secure checkout',
          description: 'Processes your card payment through our encrypted Stripe checkout.',
          howToUse: 'Enter card details in the secure form, then tap Pay.',
        }),
        entry({
          id: 'secure',
          icon: Lock,
          iconClassName: 'text-blue-400',
          shortLabel: 'Secure payment',
          summary: 'SSL encrypted',
          description: 'Your payment information is encrypted and not stored on our servers.',
          howToUse: 'Look for the lock icon note under the payment button for reassurance.',
        }),
      ].filter((e) => e.visible !== false);

    default:
      return [];
  }
}

export function getPortalGuideEntries() {
  return [
    entry({
      id: 'nav-alert',
      icon: Info,
      iconClassName: 'text-orange-400',
      shortLabel: 'Colored dot on menu',
      description: 'Orange or red dots mean something needs your attention—verification or unread messages.',
      howToUse: 'Open Verification or Communication from the left menu when you see a dot.',
    }),
    entry({
      id: 'status-badge',
      icon: List,
      iconClassName: 'text-blue-300',
      shortLabel: 'Booking status',
      description: 'Color labels show whether a rental is active, pending review, or completed.',
      howToUse: 'Tap a booking for details, receipts, reschedule, or cancel options.',
    }),
    entry({
      id: 'info-blue',
      icon: Info,
      iconClassName: 'text-blue-400',
      shortLabel: 'Blue info icons',
      description: 'Tap for extra detail on fees, verification steps, or policies.',
      howToUse: 'Tap any blue ⓘ icon on the page you are viewing.',
    }),
    entry({
      id: 'reorder',
      icon: RotateCcw,
      iconClassName: 'text-green-400',
      shortLabel: 'Reorder / Quick reorder',
      description: 'Starts a new booking using details from a past completed order.',
      howToUse: 'Tap Reorder on the dashboard or booking list.',
    }),
    entry({
      id: 'reschedule-cancel',
      icon: Calendar,
      iconClassName: 'text-yellow-400',
      shortLabel: 'Reschedule or Cancel',
      description: 'Change dates or cancel an upcoming rental from your booking details.',
      howToUse: 'Open a booking and use Reschedule or Cancel. Reschedule opens a guided flow with its own help.',
    }),
  ];
}

export function getRescheduleGuideEntries() {
  return [
    entry({
      id: 'info-fees',
      icon: Info,
      iconClassName: 'text-blue-400',
      shortLabel: 'Info on add-ons & fees',
      description: 'Explains optional charges, insurance, and equipment on your updated order.',
      howToUse: 'Tap ⓘ next to line items when comparing original vs new pricing.',
    }),
    entry({
      id: 'alert-warning',
      icon: AlertCircle,
      iconClassName: 'text-orange-400 animate-pulse',
      shortLabel: 'Orange warnings',
      description: 'Important notices about address, pricing, or policy before you submit.',
      howToUse: 'Read orange alert boxes carefully before tapping Next or Submit.',
    }),
    entry({
      id: 'address-verify',
      icon: MapPin,
      iconClassName: 'text-green-400',
      shortLabel: 'Address verification',
      description: 'Confirm delivery location so mileage and fees calculate correctly.',
      howToUse: 'Complete the address step and use refresh/verify if the map looks wrong.',
    }),
    entry({
      id: 'pricing-calc',
      icon: Clock,
      iconClassName: 'text-gray-400 animate-pulse',
      shortLabel: 'Calculating pricing',
      description: 'Wait for totals to finish updating after you change dates, address, or add-ons.',
      howToUse: 'Do not submit until the price breakdown shows final numbers.',
    }),
  ];
}
