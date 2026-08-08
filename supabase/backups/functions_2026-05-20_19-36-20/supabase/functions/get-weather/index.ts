import { corsHeaders } from "./cors.ts";
import { eachDayOfInterval, parseISO } from "npm:date-fns";
const WEATHER_API_KEY = Deno.env.get("WEATHER_API_KEY");
const LOCATION = "Saratoga Springs,UT";
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  if (!WEATHER_API_KEY) {
    return new Response(JSON.stringify({
      forecast: {},
      message: "Weather API key not configured."
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  }
  try {
    const { startDate, endDate } = await req.json();
    if (!startDate || !endDate) {
      throw new Error("Start and end dates are required.");
    }
    const sDate = parseISO(startDate);
    const eDate = parseISO(endDate);
    const days = eachDayOfInterval({
      start: sDate,
      end: eDate
    });
    const numberOfDays = Math.min(days.length, 14); // WeatherAPI free tier max forecast is 14 days
    const url = `http://api.weatherapi.com/v1/forecast.json?key=${WEATHER_API_KEY}&q=${LOCATION}&days=${numberOfDays}&aqi=no&alerts=no`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Weather API request failed with status: ${response.status}`);
    }
    const data = await response.json();
    const forecast = {};
    if (data.forecast && data.forecast.forecastday) {
      data.forecast.forecastday.forEach((day)=>{
        forecast[day.date] = day.day.condition.text;
      });
    }
    return new Response(JSON.stringify({
      forecast
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Get weather function error:", error.message);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
});
