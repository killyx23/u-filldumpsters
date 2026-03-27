export const getServiceContent = (planId) => {
  const id = Number(planId);

  // Plan 2: Dump Loader Trailer Rental
  if (id === 2) {
    return {
      serviceName: 'Dump Loader Trailer Rental',
      description: 'Pick up the trailer at our South Saratoga Springs location. A 2-5/16" ball hitch is required.',
      whatNextSteps: [
        { 
          title: 'Trailer Ready', 
          description: "We'll have the dump loader trailer ready for pickup at our South Saratoga Springs location." 
        },
        { 
          title: 'Pickup', 
          description: "You'll pick up the trailer on the scheduled drop-off date at the specified time." 
        },
        { 
          title: 'Usage', 
          description: "You can use the trailer during your rental period." 
        },
        { 
          title: 'Return Deadline', 
          description: "You must return the trailer by the scheduled pickup date and time." 
        },
        { 
          title: 'Return Location', 
          description: "Return location is South Saratoga Springs." 
        }
      ],
      serviceSpecificDetails: {
        pickupLocation: 'South Saratoga Springs',
        requirements: '2-5/16" ball hitch required'
      }
    };
  }

  // Plan 3: Junk Removal
  if (id === 3) {
    return {
      serviceName: 'Junk Removal',
      description: 'Professional junk removal service - we come to your location and remove items.',
      whatNextSteps: [
        { 
          title: 'Arrival', 
          description: "We'll arrive at your location on the scheduled date and time." 
        },
        { 
          title: 'Assessment & Removal', 
          description: "Our team will assess and remove the junk items." 
        },
        { 
          title: 'Haul Away', 
          description: "We'll haul away all debris." 
        },
        { 
          title: 'Complete', 
          description: "Your junk removal is complete." 
        }
      ],
      serviceSpecificDetails: {}
    };
  }

  // Plan 1 (Default): Dumpster Rental
  return {
    serviceName: 'Dumpster Rental',
    description: 'We deliver a dumpster to your location, you fill it, we pick it up.',
    whatNextSteps: [
      { 
        title: 'Delivery', 
        description: "We'll deliver the dumpster to your location on the scheduled drop-off date." 
      },
      { 
        title: 'Usage', 
        description: "You can fill the dumpster at your convenience during the rental period." 
      },
      { 
        title: 'Pickup', 
        description: "We'll pick up the dumpster on the scheduled pickup date." 
      },
      { 
        title: 'Complete', 
        description: "Your rental is complete." 
      }
    ],
    serviceSpecificDetails: {}
  };
};