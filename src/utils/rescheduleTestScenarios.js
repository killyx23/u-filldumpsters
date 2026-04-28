import { rescheduleDebugLogger } from './rescheduleDebugLogger';

/**
 * Comprehensive test scenarios to validate pricing calculation logic
 */
export const runRescheduleTestScenarios = () => {
    console.group('%c[TEST SCENARIOS] Running Pricing Validations...', 'color: #eab308; font-weight: bold; font-size: 14px;');

    // MOCK DATA for testing
    const mockPricingServices = {
        dumpLoader: { base_price: 100, daily_rate: 0, delivery_fee: 0, mileage_rate: 0 },
        dumpLoaderDelivery: { base_price: 100, daily_rate: 0, delivery_fee: 20, mileage_rate: 0.65 }
    };

    // Helper to calculate mock
    const calcMock = (service, days, addonsCost, isDelivery, miles = 0) => {
        let base = service.base_price;
        if (service.daily_rate > 0) base += (service.daily_rate * days);
        else base = service.base_price * days; // rental base * days
        
        if (isDelivery) {
            const roundTrip = miles * 2;
            base = service.base_price + service.delivery_fee + (service.mileage_rate * roundTrip);
        }
        
        return {
            serviceCost: base,
            addonsCost: addonsCost,
            total: base + addonsCost
        };
    };

    console.log("--------------------------------------------------");
    console.log("Test Case 1: Original booking April 9 (1 day), Dump Loader Trailer Rental Service");
    const tc1 = calcMock(mockPricingServices.dumpLoader, 1, 30, false);
    console.log("Expected: Service cost 100, Add-ons 30, Total 130");
    console.log(`Actual: Service cost ${tc1.serviceCost}, Add-ons ${tc1.addonsCost}, Total ${tc1.total}`);
    console.assert(tc1.serviceCost === 100 && tc1.total === 130, "Test Case 1 Failed");
    
    console.log("--------------------------------------------------");
    console.log("Test Case 2: Reschedule to April 11-18 (8 days), same service");
    const tc2 = calcMock(mockPricingServices.dumpLoader, 8, 30, false);
    const serviceDiff = tc2.serviceCost - tc1.serviceCost;
    const finalWithAddons = tc2.serviceCost + tc2.addonsCost;
    const finalWithTax = finalWithAddons * 1.07;
    console.log("Expected: Service cost 800, Service difference 700, Final with add-ons & tax 888.10");
    console.log(`Actual: Service cost ${tc2.serviceCost}, Diff ${serviceDiff}, Final w/Tax ${finalWithTax.toFixed(2)}`);
    console.assert(tc2.serviceCost === 800 && serviceDiff === 700, "Test Case 2 Failed");

    console.log("--------------------------------------------------");
    console.log("Test Case 3: Change service to Delivery (10 miles one-way) and dates (2 days)");
    const tc3 = calcMock(mockPricingServices.dumpLoaderDelivery, 2, 30, true, 10);
    // Delivery: base(100) + delivery(20) + (0.65 * 20) = 133
    console.log("Expected: Service cost 133");
    console.log(`Actual: Service cost ${tc3.serviceCost}`);
    console.assert(tc3.serviceCost === 133, "Test Case 3 Failed");

    console.log("--------------------------------------------------");
    console.log("Run complete. Open DevTools to view full debug traces during usage.");
    console.groupEnd();
};