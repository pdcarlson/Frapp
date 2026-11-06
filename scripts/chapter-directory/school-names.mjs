// A school's short name and the other names people search it by.
//
// `university` in the directory is the school's full name (its Wikipedia
// article title), because that is what a search should find and what the row
// shows. People also type the short form ("RPI", "Ole Miss"), so each row
// carries those as `aliases`, which search matches but nothing displays.
//
// KNOWN holds the short names and nicknames that can't be derived from the
// full name. Everything else falls back to `derived()`: the initials of a
// three-or-more-word name ("Rensselaer Polytechnic Institute" -> "RPI"),
// else the name without "University"/"College". Adding a school here is the
// fix when a search by its common name misses.

/** Full name -> [short name, ...more aliases]. */
const KNOWN = {
  "Rensselaer Polytechnic Institute": ["RPI", "Rensselaer"],
  "Massachusetts Institute of Technology": ["MIT"],
  "California Institute of Technology": ["Caltech"],
  "Georgia Institute of Technology": ["Georgia Tech", "GT"],
  "Virginia Tech": ["Virginia Tech", "VT", "Virginia Polytechnic Institute and State University"],
  "Rochester Institute of Technology": ["RIT"],
  "Worcester Polytechnic Institute": ["WPI"],
  "Stevens Institute of Technology": ["Stevens"],
  "Carnegie Mellon University": ["CMU", "Carnegie Mellon"],
  "University of California, Los Angeles": ["UCLA"],
  "University of California, Berkeley": ["Berkeley", "Cal", "UC Berkeley"],
  "University of California, San Diego": ["UCSD", "UC San Diego"],
  "University of California, Santa Barbara": ["UCSB"],
  "University of California, Davis": ["UC Davis"],
  "University of California, Irvine": ["UC Irvine", "UCI"],
  "University of California, Riverside": ["UCR"],
  "University of California, Santa Cruz": ["UCSC"],
  "University of Southern California": ["USC"],
  "University of Michigan": ["UMich", "Michigan"],
  "Michigan State University": ["MSU", "Michigan State"],
  "Ohio State University": ["OSU", "Ohio State", "The Ohio State University"],
  "Pennsylvania State University": ["Penn State", "PSU"],
  "University of Pennsylvania": ["Penn", "UPenn"],
  "University of Mississippi": ["Ole Miss"],
  "Mississippi State University": ["MSU", "Mississippi State"],
  "University of Missouri": ["Mizzou"],
  "Louisiana State University": ["LSU"],
  "University of Georgia": ["UGA"],
  "University of Florida": ["UF"],
  "Florida State University": ["FSU"],
  "University of Central Florida": ["UCF"],
  "University of South Florida": ["USF"],
  "University of Tennessee": ["UTK", "Tennessee"],
  "University of Texas at Austin": ["UT Austin", "UT", "Texas"],
  "Texas A&M University": ["Texas A&M", "TAMU", "A&M"],
  "Texas Christian University": ["TCU"],
  "Texas Tech University": ["Texas Tech", "TTU"],
  "Southern Methodist University": ["SMU"],
  "Baylor University": ["Baylor"],
  "University of Alabama": ["Alabama", "UA", "Bama"],
  "Auburn University": ["Auburn"],
  "University of Arkansas": ["Arkansas", "UARK"],
  "University of Kentucky": ["UK", "Kentucky"],
  "University of South Carolina": ["USC", "South Carolina", "UofSC"],
  "Clemson University": ["Clemson"],
  "University of North Carolina at Chapel Hill": ["UNC", "Chapel Hill", "Carolina"],
  "North Carolina State University": ["NC State", "NCSU"],
  "North Carolina A&T State University": ["NC A&T", "NCAT"],
  "Duke University": ["Duke"],
  "Wake Forest University": ["Wake Forest", "Wake"],
  "University of Virginia": ["UVA"],
  "Washington and Lee University": ["W&L", "WLU"],
  "College of William & Mary": ["William & Mary", "W&M"],
  "Vanderbilt University": ["Vanderbilt", "Vandy"],
  "Indiana University Bloomington": ["IU", "Indiana"],
  "Purdue University": ["Purdue"],
  "University of Illinois Urbana-Champaign": ["UIUC", "Illinois"],
  "University of Wisconsin–Madison": ["UW–Madison", "UW Madison", "Wisconsin"],
  "University of Minnesota": ["UMN", "Minnesota"],
  "University of Iowa": ["Iowa"],
  "Iowa State University": ["ISU", "Iowa State"],
  "University of Nebraska–Lincoln": ["UNL", "Nebraska"],
  "University of Kansas": ["KU", "Kansas"],
  "Kansas State University": ["K-State", "KSU"],
  "University of Oklahoma": ["OU", "Oklahoma"],
  "Oklahoma State University–Stillwater": ["OSU", "Oklahoma State"],
  "University of Colorado Boulder": ["CU Boulder", "Colorado"],
  "University of Arizona": ["UA", "Arizona"],
  "Arizona State University": ["ASU", "Arizona State"],
  "University of Utah": ["Utah"],
  "University of Washington": ["UW", "UDub"],
  "Washington State University": ["WSU", "Wazzu"],
  "University of Oregon": ["UO", "Oregon"],
  "Oregon State University": ["OSU", "Oregon State"],
  "San Diego State University": ["SDSU"],
  "San Jose State University": ["SJSU"],
  "California Polytechnic State University, San Luis Obispo": ["Cal Poly", "Cal Poly SLO"],
  "Boston University": ["BU"],
  "Boston College": ["BC"],
  "Northeastern University": ["Northeastern", "NEU"],
  "Syracuse University": ["Syracuse", "SU", "Cuse"],
  "Cornell University": ["Cornell"],
  "Columbia University": ["Columbia"],
  "New York University": ["NYU"],
  "Rutgers University": ["Rutgers"],
  "Rutgers University–New Brunswick": ["Rutgers"],
  "University of Maryland, College Park": ["UMD", "Maryland"],
  "Johns Hopkins University": ["JHU", "Hopkins"],
  "Georgetown University": ["Georgetown"],
  "George Washington University": ["GWU", "GW"],
  "Howard University": ["Howard"],
  "Morgan State University": ["Morgan State", "Morgan"],
  "University of Connecticut": ["UConn"],
  "University of Massachusetts Amherst": ["UMass", "UMass Amherst"],
  "University of Delaware": ["UD", "Delaware"],
  "University of Pittsburgh": ["Pitt"],
  "Lehigh University": ["Lehigh"],
  "Bucknell University": ["Bucknell"],
  "Lafayette College": ["Lafayette"],
  "Dartmouth College": ["Dartmouth"],
  "Brown University": ["Brown"],
  "Yale University": ["Yale"],
  "Harvard University": ["Harvard"],
  "Princeton University": ["Princeton"],
  "Stanford University": ["Stanford"],
  "Northwestern University": ["Northwestern", "NU"],
  "University of Chicago": ["UChicago"],
  "University of Notre Dame": ["Notre Dame", "ND"],
  "Miami University": ["Miami of Ohio", "Miami (OH)", "MU"],
  "University of Miami": ["UM", "The U"],
  "University of Cincinnati": ["UC", "Cincinnati"],
  "Ohio University": ["OU", "Ohio"],
  "Bowling Green State University": ["BGSU", "Bowling Green"],
  "Kent State University": ["Kent State"],
  "Case Western Reserve University": ["CWRU", "Case Western", "Case"],
  "West Virginia University": ["WVU"],
  "Virginia Commonwealth University": ["VCU"],
  "James Madison University": ["JMU"],
  "George Mason University": ["GMU", "Mason"],
  "Old Dominion University": ["ODU"],
  "University of Louisville": ["UofL", "Louisville"],
  "Western Kentucky University": ["WKU"],
  "University of Memphis": ["Memphis"],
  "Middle Tennessee State University": ["MTSU"],
  "East Carolina University": ["ECU"],
  "Appalachian State University": ["App State"],
  "University of North Texas": ["UNT"],
  "University of Houston": ["UH"],
  "Texas State University": ["Texas State", "TXST"],
  "University of Texas at Dallas": ["UTD", "UT Dallas"],
  "University of Texas at San Antonio": ["UTSA"],
  "University of Nevada, Las Vegas": ["UNLV"],
  "University of Nevada, Reno": ["UNR"],
  "University of New Mexico": ["UNM"],
  "Brigham Young University": ["BYU"],
  "Colorado State University": ["CSU"],
  "University of Denver": ["DU"],
  "Colorado School of Mines": ["Mines"],
  "Missouri University of Science and Technology": ["Missouri S&T", "S&T", "Rolla"],
  "Saint Louis University": ["SLU"],
  "Washington University in St. Louis": ["WashU", "WUSTL"],
  "University of Rochester": ["UR"],
  "University at Buffalo": ["UB", "Buffalo", "SUNY Buffalo"],
  "Binghamton University": ["Binghamton", "SUNY Binghamton"],
  "Stony Brook University": ["Stony Brook", "SUNY Stony Brook"],
  "University at Albany, SUNY": ["UAlbany", "SUNY Albany"],
  "Clarkson University": ["Clarkson"],
  "Union College": ["Union"],
  "Hobart and William Smith Colleges": ["HWS", "Hobart"],
  "Colgate University": ["Colgate"],
  "Hamilton College": ["Hamilton"],
  "Siena College": ["Siena"],
  "Drexel University": ["Drexel"],
  "Temple University": ["Temple"],
  "Villanova University": ["Villanova", "Nova"],
  "Penn State Erie, The Behrend College": ["Penn State Behrend", "Behrend"],
  "University of Rhode Island": ["URI"],
  "University of Vermont": ["UVM"],
  "University of New Hampshire": ["UNH"],
  "University of Maine": ["UMaine"],
  "Quinnipiac University": ["Quinnipiac", "QU"],
  "Butler University": ["Butler"],
  "DePauw University": ["DePauw"],
  "Wabash College": ["Wabash"],
  "Emory University": ["Emory"],
  "Tulane University": ["Tulane"],
  "Kean University": ["Kean"],
  "University of Toronto": ["U of T", "UofT"],
  "McGill University": ["McGill"],
  "University of British Columbia": ["UBC"],
  "University of Calgary": ["UCalgary"],
};

const SMALL = new Set(["of", "the", "and", "at", "in", "for", "&", "a", "an"]);

function derived(name) {
  const words = name
    .replace(/[,–—-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const significant = words.filter((w) => !SMALL.has(w.toLowerCase()));
  if (significant.length >= 3) {
    return significant.map((w) => w[0].toUpperCase()).join("");
  }
  const stripped = name
    .replace(/^(The )?(University|College) of /i, "")
    .replace(/ (University|College)$/i, "")
    .trim();
  return stripped || name;
}

/**
 * `{ short, aliases }` for a school. `shown` is the label the source list used
 * for it, kept as an alias when it differs from the full name.
 */
export function schoolNames(university, shown) {
  const known = KNOWN[university];
  const short = known ? known[0] : derived(university);
  const aliases = new Set(known ?? [short]);
  if (shown && shown !== university) aliases.add(shown);
  aliases.delete(university);
  return { short, aliases: [...aliases] };
}
