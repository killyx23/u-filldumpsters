

export const getServiceTerminology = (serviceId, isDelivery = false) => {
    // Default fallback
    const fallback = {
        dialogTitle: "Select New Dates & Times",
        pickupLabel: "End Date",
        dropoffLabel: "Start Date",
        returnLabel: "Return Time",
        actionVerb: "Rent"
    };

    switch (serviceId) {
        case 1: // Dumpster
            return {
                dialogTitle: "Select New Delivery & Pickup Schedule",
                dropoffLabel: "Delivery Date",
                pickupLabel: "Pickup Date",
                returnLabel: "Pickup",
                actionVerb: "Deliver"
            };
        case 2: // Dump Loader Trailer
            if (isDelivery) {
                return {
                    dialogTitle: "Select New Delivery & Pickup Schedule",
                    dropoffLabel: "Drop-off Date",
                    pickupLabel: "Pickup Date",
                    returnLabel: "Pickup",
                    actionVerb: "Deliver"
                };
            } else {
                return {
                    dialogTitle: "Select New Pickup & Return Schedule",
                    dropoffLabel: "Pickup Date",
                    pickupLabel: "Return Date",
                    returnLabel: "Return",
                    actionVerb: "Pickup"
                };
            }
        case 4: // Delivery specific plan if separated
            return {
                dialogTitle: "Select New Delivery & Pickup Schedule",
                dropoffLabel: "Drop-off Date",
                pickupLabel: "Pickup Date",
                returnLabel: "Pickup",
                actionVerb: "Deliver"
            };
        default:
            return fallback;
    }
};

export const getServiceDescription = (serviceId) => {
    switch (serviceId) {
        case 1:
            return "16 Yard Dumpster Rental perfect for mid-to-large cleanouts. Delivered to your location.";
        case 2:
            return "Dump Loader Trailer Rental. Heavy-duty solution for hauling materials. Pickup or delivery available.";
        default:
            return "Premium equipment rental service.";
    }
};
