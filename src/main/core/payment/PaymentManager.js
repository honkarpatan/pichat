import { loadScript } from "@paypal/paypal-js";

export class PaymentManager {
    static async addPaypalSetting(email) {
        console.log('ADDPAYPALSETTING_______________>');
        const basePrices = { 1: 0.99, 6: 4.99, 12: 8.19 };
        const baseTokens = 6; 

        const paypal = await loadScript({
            clientId: "AUzFPo6JoHXG2rdKwSSYFZ64IV-HGlU9dXVKsU1hFTT3UMoFSK4g9AkdR_o05-2xlAFVAaJjEs-q7i9R",
            currency: "USD"
        });

        if (!paypal) return console.error("Failed to load PayPal SDK.");

        function calculatePrice(months, tokensPerDay) {
            const multiplier = tokensPerDay / baseTokens;
            return (basePrices[months] * multiplier).toFixed(2);
        }

        function updatePrices() {
            const tokenSlider = document.getElementById("range_tokens");
            const tokenDisplay = document.getElementById("token-value");
            if (!tokenSlider) return;

            const tokensPerDay = tokenSlider.value;
            if (tokenDisplay) tokenDisplay.innerText = tokensPerDay;

            [1, 6, 12].forEach(months => {
                const priceElement = document.getElementById(`price-${months}`);
                const containerId = `#paypal-button-container-${months}`;
                if (priceElement) {
                    const newPrice = calculatePrice(months, tokensPerDay);
                    priceElement.innerText = newPrice;
                    renderPayPalButton(containerId, newPrice, months);
                }
            });
        }

        function renderPayPalButton(containerId, price, months) {
            const container = document.querySelector(containerId);
            if (!container) return;
            container.innerHTML = ""; 

            paypal.Buttons({
                createOrder: (data, actions) => {
                    return actions.order.create({
                        purchase_units: [{
                            amount: { value: price },
                            description: `${months} Month Sub - ${price} USD for ${email}`, 
                            custom_id: `subscription_${months}_months`, 
                        }]
                    });
                },
                onApprove: (data, actions) => {
                    return actions.order.capture().then((details) => {
                        alert(`Transaction completed by ${details.payer.name.given_name}`);
                    });
                },
                onError: (err) => console.error("Transaction Failed:", err)
            }).render(container);
        }

        updatePrices();
        const tokenSlider = document.getElementById("range_tokens");
        if (tokenSlider) tokenSlider.addEventListener("input", updatePrices);
    }
}