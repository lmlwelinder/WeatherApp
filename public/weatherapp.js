function updateWeather(){
    // console.log("Refreshing Weather");
    window.location.reload();
}

if(document.getElementById("locationbody")){
    setTimeout(updateWeather, 5 * 60 * 1000);
}

