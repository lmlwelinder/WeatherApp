require('dotenv').config()
const escapeHtml = require('escape-html');
const session = require('express-session');
const bodyParser = require("body-parser");
const express = require("express");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require('mongodb');

// Schema for user collection:
//    username: <str>
//    password: <str>

// Schema for location collection:
//    username: <str>
//    locations: <array[str]>

const portNumber = process.env.PORT || 5000;
const app = express();

const mongoURI = `mongodb+srv://${process.env.MONGO_DB_USERNAME}:${process.env.MONGO_DB_PASSWORD}@cluster0.9jgzmk4.mongodb.net/${process.env.MONGO_DB_NAME}?retryWrites=true&w=majority&appName=Cluster0`
const client = new MongoClient(mongoURI);

let users;
let locations;

(async () => {
    await client.connect();
    users = await client.db().collection(process.env.MONGO_USER_COLLECTION);
    locations = await client.db().collection(process.env.MONGO_LOCATION_COLLECTION);
})();

app.set("views", path.resolve(__dirname, "templates"));
app.use(bodyParser.urlencoded({extended:false}));
app.use(express.static('public'));

app.use(session({
    secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true
}))

// ========================================== //
//               Authentication               //
// ========================================== //
let auth = express.Router(); 

auth.get("/", (req, res) => {
    if(req.session.username){
	res.redirect("/locations");
    }else{
	res.redirect("/login");
    }
});

auth.get("/login", (req, res) => {
    res.render("login.ejs", {message: ""});
});

auth.post("/login/check", async (req, res) => {
    let user = await users.findOne({username: req.body.username});

    if(user && user.password === req.body.password){
	req.session.regenerate(function (err) {
	    if(err){
		next(err);
	    }
	    // store user information in session, typically a user id
	    req.session.username = req.body.username;
	    
	    // save the session before redirection to ensure page
	    // load does not happen before session is saved
	    req.session.save(function (err) {
		if (err) return next(err)
		res.redirect("/locations");
	    })
	})
    }else{	
	res.render("login.ejs", {message: "Incorrect username/password"});
    }
});

auth.post("/login/create", async (req, res) => {
    let user = await users.findOne({username: req.body.username});

    if(user){
	res.render("login.ejs", {message: "Username already exists"});
    }else{	
	const result = await users.insertOne({username: req.body.username,
					      password: req.body.password});

	// store user information in session, typically a user id
	req.session.username = req.body.username;
	
	// save the session before redirection to ensure page
	// load does not happen before session is saved
	req.session.save(function (err) {
	    if (err) return next(err)
	    res.redirect("/locations");
	})	
    }    
});

auth.get('/logout', function (req, res, next) {
  req.session.username = null
  req.session.save(function (err) {
    if (err) next(err)

    req.session.regenerate(function (err) {
      if (err) next(err)
      res.redirect('/login')
    });
  });
});

// middleware to test if authenticated
function isAuthenticated (req, res, next) {
    if (req.session.username){
	next();
    }else{
	next('route');
    }
}

app.use(auth);

// ========================================== //
//                 Application                //
// ========================================== //
async function renderSlot(loc){
    if(!loc){
	return `<div class="centerhv"><a href="/managelocations">Click to add</a></div>`;
    }

    try{
	let data = await fetch(`${process.env.WEATHER_API_URL}/current.json?key=${process.env.WEATHER_API_KEY}&q=${loc}&aqi=no`);

	if(!data.ok){
	    throw new Error("Location not found");
	}
	
	let json = await data.json();
	
	let title = json.location.name + ", " + json.location.region;
	let localtime = "Local time: " + json.location.localtime;
	let temp = json.current.temp_f + "°F";
	let wind = json.current.wind_mph + " mph";
	let humidity = json.current.humidity + "%";
	
	let icon = `<img src="${json.current.condition.icon}" alt="${escapeHtml(json.current.condition.text)}">`;
	
	return `
<table class="slottable">
<tr><th colspan="4">${escapeHtml(title)}</th></tr>
<tr><td class="centered" colspan="4">${escapeHtml(localtime)}</tr>
<tr><td>Temperature</td><td>${escapeHtml(temp)}</td><td class="weathericon" colspan="2" rowspan="2">${icon}</td></tr>
<tr><td>Wind</td><td>${escapeHtml(wind)}</td></tr>
<tr><td>Humidity</td><td>${escapeHtml(humidity)}</td></tr>
</table>`;
    }catch(error) {
	return `<div class="centerhv">Invalid Location</div>`;
    }
}

app.get("/locations", isAuthenticated, async (req, res) => {
    const result = await locations.findOne({username: req.session.username});
    let locs = result ? result.locations : [];

    let slot1 = await renderSlot(locs[0]);
    let slot2 = await renderSlot(locs[1]);
    let slot3 = await renderSlot(locs[2]);
    let slot4 = await renderSlot(locs[3]);    
    
    res.render("locations.ejs", {slot1: slot1, slot2: slot2, slot3: slot3, slot4: slot4});
});

function renderEditLine(loc, num){
    let name  = loc ?? "";

    return `<input type="text" name="slot${num}" width="25%" value="${escapeHtml(name)}">\n`;
}

app.get("/managelocations", isAuthenticated, async (req, res) => {
    const result = await locations.findOne({username: req.session.username});
    let locs = result ? result.locations : [];

    let slot1 = renderEditLine(locs[0], 1);
    let slot2 = renderEditLine(locs[1], 2);
    let slot3 = renderEditLine(locs[2], 3);
    let slot4 = renderEditLine(locs[3], 4);    
    
    res.render("managelocations.ejs", {slot1: slot1, slot2: slot2, slot3: slot3, slot4: slot4});
});

app.post("/locations/update", isAuthenticated, async (req, res) => {
    let locs = [req.body.slot1, req.body.slot2, req.body.slot3, req.body.slot4];
    let record = {username: req.session.username, locations: locs};
    
    await locations.replaceOne({username: req.session.username}, record, {upsert: true});
    res.redirect("/locations");
});

// ========================================== //
//             Interactive Driver             //
// ========================================== //
async function wipeAllUsers(){
    await users.deleteMany({});
    await locations.deleteMany({});
}

(async () => {
    app.listen(portNumber, (err) => {
	if (err) {
	    console.log("Starting server failed.");
	} else {
	    console.log(`Web server started and running at http://localhost:${portNumber}`);
	    
	    console.log("Stop to shutdown the server: ");
	    process.stdin.setEncoding("utf8"); /* encoding */
	    process.stdin.on('readable', () => {  /* on equivalent to addEventListener */
		const dataInput = process.stdin.read();
		if (dataInput !== null) {
		    const command = dataInput.trim();
		    if (command === "stop") {
			// Not using console.log as it adds a newline by default
			process.stdout.write("Shutting down the server"); 
			process.exit(0);  /* exiting */
		    }else if(command == "admin wipe") {
			wipeAllUsers();
		    }else{
			/* After invalid command, we cannot type anything else */
			console.log(`Invalid command: ${command}`);
		    }
		    console.log("Stop to shutdown the server: ");
		    
		    process.stdin.resume(); // Allows the code to process next request
		}
	    });
	}
    });
})();
