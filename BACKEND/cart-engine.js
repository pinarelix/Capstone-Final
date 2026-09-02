// ============================================================
// CART ENGINE - Barangay 179 Crime BI
// Rule-Based Decision Tree for Risk Classification
// ============================================================

class CARTEngine {
    constructor() {
        // ============================================================
        // 1. WEIGHTS - Expert-defined importance of each factor
        // Total = 1.0 (100%)
        // ============================================================
        this.weights = {
            time: 0.25,      // 25% - Time of day
            day: 0.15,       // 15% - Weekend vs Weekday
            type: 0.30,      // 30% - Incident type (most important)
            location: 0.20,  // 20% - Location history
            frequency: 0.10  // 10% - Recent frequency
        };

        // ============================================================
        // 2. THRESHOLDS - Danger level boundaries
        // ============================================================
        this.thresholds = {
            level3: 67,  // >= 67 = Level 3 (High Risk)
            level2: 34   // >= 34 = Level 2 (Moderate Risk)
            // < 34 = Level 1 (Low Risk)
        };

        // ============================================================
        // 3. SCORE MAPPINGS - Domain expertise
        // ============================================================
        this.scores = {
            // Time of Day Scores
            time: {
                'Night': 90,
                'Evening': 70,
                'Afternoon': 40,
                'Morning': 20,
                'default': 20
            },
            
            // Day Type Scores
            day: {
                'weekend': 70,
                'weekday': 40
            },
            
            // Incident Type Scores
            type: {
                'Theft': 90,
                'Physical Injury': 85,
                'Noise Complaint': 50,
                'Vandalism': 30,
                'Suspicious Activity': 40,
                'Traffic Obstruction': 40,
                'Curfew Violation': 50,
                'default': 30
            },
            
            // Location Risk Scores (based on total incidents in area)
            location: {
                'critical': 90,   // >= 5 incidents
                'high': 70,       // >= 3 incidents
                'moderate': 50,   // >= 2 incidents
                'low': 30,        // >= 1 incident
                'none': 10        // 0 incidents
            },
            
            // Frequency Scores (based on recent incidents - 30 days)
            frequency: {
                'very_high': 95,  // >= 5 incidents
                'high': 75,       // >= 3 incidents
                'moderate': 50,   // >= 2 incidents
                'low': 25,        // >= 1 incident
                'none': 5         // 0 incidents
            }
        };
    }

    // ============================================================
    // 4. SCORE GETTERS
    // ============================================================

    /**
     * Get time score based on time of day
     * @param {string} timeOfDay - 'Morning', 'Afternoon', 'Evening', 'Night'
     * @returns {number} Score (20-90)
     */
    getTimeScore(timeOfDay) {
        return this.scores.time[timeOfDay] || this.scores.time.default;
    }

    /**
     * Get day score based on weekend or weekday
     * @param {boolean} isWeekend - True if weekend
     * @returns {number} Score (40-70)
     */
    getDayScore(isWeekend) {
        return isWeekend ? this.scores.day.weekend : this.scores.day.weekday;
    }

    /**
     * Get type score based on incident type
     * @param {string} incidentType - Type of incident
     * @returns {number} Score (30-90)
     */
    getTypeScore(incidentType) {
        return this.scores.type[incidentType] || this.scores.type.default;
    }

    /**
     * Get location score based on incident count
     * @param {number} incidentCount - Total incidents in location
     * @returns {number} Score (10-90)
     */
    getLocationScore(incidentCount) {
        if (incidentCount >= 5) return this.scores.location.critical;
        if (incidentCount >= 3) return this.scores.location.high;
        if (incidentCount >= 2) return this.scores.location.moderate;
        if (incidentCount >= 1) return this.scores.location.low;
        return this.scores.location.none;
    }

    /**
     * Get frequency score based on recent incidents (30 days)
     * @param {number} recentCount - Recent incidents in location
     * @returns {number} Score (5-95)
     */
    getFrequencyScore(recentCount) {
        if (recentCount >= 5) return this.scores.frequency.very_high;
        if (recentCount >= 3) return this.scores.frequency.high;
        if (recentCount >= 2) return this.scores.frequency.moderate;
        if (recentCount >= 1) return this.scores.frequency.low;
        return this.scores.frequency.none;
    }

    // ============================================================
    // 5. CALCULATION METHODS
    // ============================================================

    /**
     * Calculate total risk score using weighted average
     * @param {Object} scores - Individual scores
     * @returns {number} Total score (0-100)
     */
    calculateTotalScore(scores) {
        const { time, day, type, location, frequency } = scores;
        
        return (
            (time * this.weights.time) +
            (day * this.weights.day) +
            (type * this.weights.type) +
            (location * this.weights.location) +
            (frequency * this.weights.frequency)
        );
    }

    /**
     * Determine danger level based on total score
     * @param {number} totalScore - Total risk score
     * @returns {string} 'Level 1', 'Level 2', or 'Level 3'
     */
    getDangerLevel(totalScore) {
        if (totalScore >= this.thresholds.level3) {
            return 'Level 3';
        } else if (totalScore >= this.thresholds.level2) {
            return 'Level 2';
        } else {
            return 'Level 1';
        }
    }

    /**
     * Get full danger level description
     * @param {string} level - 'Level 1', 'Level 2', or 'Level 3'
     * @returns {string} Full description
     */
    getDangerLevelDescription(level) {
        const descriptions = {
            'Level 3': 'Level 3 — High Crime / Considerable Danger',
            'Level 2': 'Level 2 — Moderate Danger / Caution Area',
            'Level 1': 'Level 1 — Low Danger / Stable Area'
        };
        return descriptions[level] || level;
    }

    // ============================================================
    // 6. MAIN ANALYSIS METHOD
    // ============================================================

    /**
     * Analyze incident and return complete risk assessment
     * @param {Object} incident - Incident data
     * @param {Object} locationData - Location statistics
     * @param {Object} frequencyData - Frequency statistics
     * @returns {Object} Complete risk assessment
     */
    analyze(incident, locationData, frequencyData) {
        // 1. Get individual scores
        const timeScore = this.getTimeScore(incident.time_of_day);
        const dayScore = this.getDayScore(incident.is_weekend || false);
        const typeScore = this.getTypeScore(incident.incident_type);
        const locationScore = this.getLocationScore(locationData?.street_count || 0);
        const frequencyScore = this.getFrequencyScore(frequencyData?.recent_count || 0);

        // 2. Calculate total
        const scores = {
            time: timeScore,
            day: dayScore,
            type: typeScore,
            location: locationScore,
            frequency: frequencyScore
        };

        const totalScore = this.calculateTotalScore(scores);
        const roundedTotal = Math.round(totalScore * 100) / 100;
        const dangerLevel = this.getDangerLevel(roundedTotal);
        const dangerDescription = this.getDangerLevelDescription(dangerLevel);

        // 3. Generate explanation
        const explanation = this.generateExplanation(
            incident,
            locationData,
            frequencyData,
            scores,
            roundedTotal,
            dangerDescription
        );

        // 4. Generate decision path
        const decisionPath = this.generateDecisionPath(
            incident,
            locationData,
            frequencyData,
            scores,
            roundedTotal,
            dangerDescription
        );

        return {
            scores: scores,
            totalScore: roundedTotal,
            dangerLevel: dangerLevel,
            dangerDescription: dangerDescription,
            explanation: explanation,
            decisionPath: decisionPath
        };
    }

    // ============================================================
    // 7. EXPLANATION GENERATORS
    // ============================================================

    /**
     * Generate human-readable explanation
     */
    generateExplanation(incident, locationData, frequencyData, scores, totalScore, dangerDescription) {
        const timeDesc = incident.time_of_day || 'Unknown Time';
        const dayDesc = incident.is_weekend ? 'Weekend' : 'Weekday';
        const typeDesc = incident.incident_type || 'Unknown Type';
        const locationCount = locationData?.street_count || 0;
        const frequencyCount = frequencyData?.recent_count || 0;
        const locationName = incident.street_name || 'unknown location';

        return `The CART engine evaluated ${typeDesc} incident at ${locationName} with ${locationCount} total and ${frequencyCount} recent incidents (30 days). 
Time: ${timeDesc} (${scores.time} pts, ${this.weights.time * 100}% weight), 
Day: ${dayDesc} (${scores.day} pts, ${this.weights.day * 100}% weight), 
Type: ${typeDesc} (${scores.type} pts, ${this.weights.type * 100}% weight), 
Location: ${locationCount} incidents (${scores.location} pts, ${this.weights.location * 100}% weight), 
Frequency: ${frequencyCount} recent (${scores.frequency} pts, ${this.weights.frequency * 100}% weight). 
Total Score: ${totalScore} → ${dangerDescription}`;
    }

    /**
     * Generate step-by-step decision path
     */
    generateDecisionPath(incident, locationData, frequencyData, scores, totalScore, dangerDescription) {
        const timeDesc = incident.time_of_day || 'Unknown Time';
        const dayDesc = incident.is_weekend ? 'Weekend' : 'Weekday';
        const typeDesc = incident.incident_type || 'Unknown Type';
        const locationCount = locationData?.street_count || 0;
        const frequencyCount = frequencyData?.recent_count || 0;
        const locationName = incident.street_name || 'unknown location';

        return [
            `1. Incident Type: ${typeDesc} → ${scores.type} points (${this.weights.type * 100}% weight)`,
            `2. Time of Day: ${timeDesc} → ${scores.time} points (${this.weights.time * 100}% weight)`,
            `3. Day Type: ${dayDesc} → ${scores.day} points (${this.weights.day * 100}% weight)`,
            `4. Location: ${locationName} (${locationCount} total incidents) → ${scores.location} points (${this.weights.location * 100}% weight)`,
            `5. Recent Frequency: ${frequencyCount} incidents in 30 days → ${scores.frequency} points (${this.weights.frequency * 100}% weight)`,
            `6. Weighted Total: ${totalScore}`,
            `7. Final Classification: ${dangerDescription}`
        ];
    }

    // ============================================================
    // 8. UTILITY METHODS
    // ============================================================

    /**
     * Get all available scores for reference
     */
    getScoreReference() {
        return {
            weights: this.weights,
            thresholds: this.thresholds,
            scores: this.scores
        };
    }

    /**
     * Update weights dynamically
     * @param {Object} newWeights - New weight values
     */
    updateWeights(newWeights) {
        Object.keys(newWeights).forEach(key => {
            if (this.weights.hasOwnProperty(key)) {
                this.weights[key] = newWeights[key];
            }
        });
    }

    /**
     * Update thresholds dynamically
     * @param {Object} newThresholds - New threshold values
     */
    updateThresholds(newThresholds) {
        Object.keys(newThresholds).forEach(key => {
            if (this.thresholds.hasOwnProperty(key)) {
                this.thresholds[key] = newThresholds[key];
            }
        });
    }
}

// ============================================================
// 9. EXPORT
// ============================================================

module.exports = new CARTEngine();

console.log('✅ CART Engine loaded successfully!');